import { readFileSync } from "node:fs";

import { describe, it, expect, vi } from "vitest";

import {
  createTripPlayer,
  planRuns,
  runDurations,
} from "../src/js/trip_player";
import { buildTrips } from "../src/js/trips";

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), "utf8"),
  );
const parksByCode = new Map(load("parks").map((p) => [p.parkCode, p]));
const trips = buildTrips(load("trips"), parksByCode);
const trip = (id) => trips.find((t) => t.id === id);

describe("planRuns", () => {
  it("draws long legs in one overview run", () => {
    expect(planRuns([80, 40, 120])).toEqual([
      { legs: [0, 1, 2], closeUp: false },
    ]);
  });

  it("zooms in on a stretch of crowded legs, then back out", () => {
    // Drive in, five legs on the Mall, drive on.
    expect(planRuns([60, 30, 4, 3, 5, 2, 6, 50])).toEqual([
      { legs: [0, 1], closeUp: false },
      { legs: [2, 3, 4, 5, 6], closeUp: true },
      { legs: [7], closeUp: false },
    ]);
  });

  it("does not zoom in for one short leg in a long trip", () => {
    expect(planRuns([60, 5, 70])).toEqual([
      { legs: [0, 1, 2], closeUp: false },
    ]);
  });

  it("a trip that stays in one city is one close-up", () => {
    expect(planRuns([3])).toEqual([{ legs: [0], closeUp: true }]);
    expect(planRuns([2, 4, 1])).toEqual([{ legs: [0, 1, 2], closeUp: true }]);
  });

  it("covers every leg once", () => {
    const lengths = [1, 50, 2, 3, 90, 4, 60, 5, 6, 7];
    expect(planRuns(lengths).flatMap((r) => r.legs)).toEqual(
      lengths.map((_, i) => i),
    );
  });
});

describe("runDurations", () => {
  it("keeps a steady speed with a floor and a budget", () => {
    expect(runDurations([400, 40])).toEqual([1000, 500]);
    const many = runDurations([4000, 4000, 4000], { budget: 6000 });
    expect(many.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6000);
  });
});

/**
 * Player with recorded effects. Every effect resolves at once unless a test
 * swaps it; `drawRun` reaches each of its legs in order.
 * @param {object[]} runs - What `plan` returns
 */
function setup(runs) {
  const log = [];
  const effects = {
    plan: () => runs,
    runLength: () => 100,
    camera: vi.fn(async (_t, run) =>
      log.push(run ? `camera ${run.legs}` : "camera overview"),
    ),
    drawRun: vi.fn(async (run, _ms, onReach) => {
      log.push(`draw ${run.legs}`);
      run.legs.forEach(onReach);
    }),
    lightStop: vi.fn((stop) => log.push(`light ${stop.park.parkCode}`)),
    finish: vi.fn((_t, { fit }) => log.push(`finish fit=${fit}`)),
    onState: vi.fn(),
  };
  return { player: createTripPlayer(effects), effects, log };
}

describe("createTripPlayer", () => {
  it("draws runs continuously, zooming only for close-ups", async () => {
    // fiis, sahi, elro, hofr, vama
    const { player, log, effects } = setup([
      { legs: [0, 1], closeUp: false },
      { legs: [2, 3], closeUp: true },
    ]);
    expect(await player.play(trip("2023-02-hudson"))).toBe(true);
    expect(log).toEqual([
      "light fiis",
      "camera overview",
      "draw 0,1",
      "light sahi",
      "light elro",
      "camera 2,3",
      "draw 2,3",
      "light hofr",
      "light vama",
      // Last run: no zoom back out before the final overview fit.
      "finish fit=true",
    ]);
    expect(effects.onState.mock.calls).toEqual([[true], [false]]);
    expect(player.isPlaying()).toBe(false);
  });

  it("returns to the overview after a close-up that is not last", async () => {
    const { player, log } = setup([
      { legs: [0], closeUp: false },
      { legs: [1, 2], closeUp: true },
      { legs: [3], closeUp: false },
    ]);
    await player.play(trip("2023-02-hudson"));
    expect(log.filter((l) => l.startsWith("camera"))).toEqual([
      "camera overview",
      "camera 1,2",
      "camera overview",
    ]);
  });

  it("skip ends at once and the cancelled run stops touching the map", async () => {
    const { player, effects, log } = setup([
      { legs: [0, 1, 2, 3], closeUp: false },
    ]);
    let release;
    effects.drawRun.mockImplementationOnce(
      (_run, _ms, onReach) =>
        new Promise((resolve) => {
          release = () => {
            onReach(0);
            resolve();
          };
        }),
    );
    const run = player.play(trip("2023-02-hudson"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    player.skip();
    expect(log.at(-1)).toBe("finish fit=true");
    release();
    expect(await run).toBe(false);
    // The late onReach did not light anything.
    expect(log.at(-1)).toBe("finish fit=true");
    expect(effects.finish).toHaveBeenCalledOnce();
  });

  it("an outside interruption ends playback where the camera is", async () => {
    const { player, effects } = setup([{ legs: [0, 1, 2, 3], closeUp: false }]);
    effects.camera.mockRejectedValueOnce(new Error("interrupted"));
    expect(await player.play(trip("2023-02-hudson"))).toBe(false);
    expect(effects.finish).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      fit: false,
    });
    expect(player.isPlaying()).toBe(false);
  });

  it("stop cancels without an end state; play restarts cleanly", async () => {
    const { player, effects } = setup([{ legs: [0], closeUp: false }]);
    let release;
    effects.camera.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const run = player.play(trip("2026-06-new-orleans"));
    player.stop();
    release();
    expect(await run).toBe(false);
    expect(effects.finish).not.toHaveBeenCalled();
    expect(await player.play(trip("2026-06-new-orleans"))).toBe(true);
    expect(effects.finish).toHaveBeenCalledOnce();
  });
});
