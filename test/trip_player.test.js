import { readFileSync } from "node:fs";

import { describe, it, expect, vi } from "vitest";

import {
  createTripPlayer,
  legDurations,
  planTrip,
} from "../src/js/trip_player";
import { buildTrips } from "../src/js/trips";

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), "utf8"),
  );
const parksByCode = new Map(load("parks").map((p) => [p.parkCode, p]));
const trips = buildTrips(load("trips"), parksByCode);
const trip = (id) => trips.find((t) => t.id === id);
const codes = (stops) => stops.map((s) => s.park.parkCode);

describe("planTrip", () => {
  it("makes one step per day; legs end on that day", () => {
    const steps = planTrip(trip("2022-10-midwest"));
    expect(steps.map((s) => s.date)).toEqual([
      "2022-10-15",
      "2022-10-16",
      "2022-10-17",
    ]);
    // stge, ulsg | jeff, liho | pull
    expect(steps.map((s) => s.legs)).toEqual([[0], [1, 2], [3]]);
    // The drive in, then the day's own stops.
    const focus = (step) => step.moves.map((m) => codes(m.focus));
    expect(focus(steps[0])).toEqual([["stge", "ulsg"]]);
    expect(focus(steps[1])).toEqual([
      ["ulsg", "jeff"],
      ["jeff", "liho"],
    ]);
    expect(focus(steps[2])).toEqual([["liho", "pull"]]);
    expect(steps[1].moves.map((m) => m.legs)).toEqual([[1], [2]]);
  });

  it("gives a run of nearby stops its own close-up move", () => {
    const steps = planTrip(trip("2024-06-mid-atlantic"));
    const mall = steps.find((s) => s.date === "2024-06-18");
    expect(mall.moves.map((m) => codes(m.focus))).toEqual([
      ["hafe", "gwmp"],
      ["gwmp", "vive"],
      [
        "vive",
        "coga",
        "wwii",
        "wamo",
        "whho",
        "wwim",
        "nama",
        "ddem",
        "thje",
        "frde",
        "mlkm",
        "kowa",
        "linc",
      ],
    ]);
  });

  it("does not move the camera for a first day with one stop", () => {
    const [first] = planTrip(trip("2023-05-california"));
    expect(first.moves).toEqual([]);
  });

  it("covers every leg exactly once for every trip", () => {
    for (const t of trips) {
      const legs = planTrip(t).flatMap((s) => s.legs);
      expect(legs, t.id).toEqual(t.stops.slice(1).map((_, i) => i));
    }
  });
});

describe("legDurations", () => {
  it("is proportional, clamped, and fits the budget", () => {
    expect(legDurations([100, 50, 1])).toEqual([1200, 600, 250]);
    const many = legDurations(Array(30).fill(10), { budget: 6000 });
    expect(many.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6000);
    expect(legDurations([0, 0])).toEqual([250, 250]);
  });
});

/**
 * Player with recorded effects. `camera`/`drawLeg` resolve at once unless
 * the test swaps them.
 */
function setup() {
  const log = [];
  const effects = {
    camera: vi.fn(async (stops) => log.push(`camera ${codes(stops)}`)),
    drawLeg: vi.fn(async (i) => log.push(`leg ${i}`)),
    legLength: () => 10,
    lightStop: vi.fn((stop) => log.push(`light ${stop.park.parkCode}`)),
    finish: vi.fn((_t, { fit }) => log.push(`finish fit=${fit}`)),
    onState: vi.fn(),
  };
  return { player: createTripPlayer(effects), effects, log };
}

describe("createTripPlayer", () => {
  it("plays day by day: camera, then legs, lighting each stop", async () => {
    const { player, log, effects } = setup();
    expect(await player.play(trip("2023-02-hudson"))).toBe(true);
    expect(log).toEqual([
      "light fiis",
      "camera fiis,sahi",
      "leg 0",
      "light sahi",
      "camera sahi,elro",
      "leg 1",
      "light elro",
      "camera elro,hofr,vama",
      "leg 2",
      "light hofr",
      "leg 3",
      "light vama",
      "finish fit=true",
    ]);
    expect(effects.onState.mock.calls).toEqual([[true], [false]]);
    expect(player.isPlaying()).toBe(false);
  });

  it("skip ends at once and the cancelled run stops touching the map", async () => {
    const { player, effects, log } = setup();
    let release;
    effects.drawLeg.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const run = player.play(trip("2023-02-hudson"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    player.skip();
    expect(log.at(-1)).toBe("finish fit=true");
    release();
    expect(await run).toBe(false);
    expect(log.at(-1)).toBe("finish fit=true");
    expect(effects.finish).toHaveBeenCalledOnce();
  });

  it("an outside interruption ends playback where the camera is", async () => {
    const { player, effects } = setup();
    effects.camera.mockRejectedValueOnce(new Error("interrupted"));
    expect(await player.play(trip("2023-02-hudson"))).toBe(false);
    expect(effects.finish).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      fit: false,
    });
    expect(player.isPlaying()).toBe(false);
  });

  it("stop cancels without an end state; play restarts cleanly", async () => {
    const { player, effects } = setup();
    let release;
    effects.camera.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const run = player.play(trip("2023-02-hudson"));
    player.stop();
    release();
    expect(await run).toBe(false);
    expect(effects.finish).not.toHaveBeenCalled();
    expect(await player.play(trip("2026-06-new-orleans"))).toBe(true);
    expect(effects.finish).toHaveBeenCalledOnce();
  });
});
