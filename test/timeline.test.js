import { describe, it, expect, vi } from "vitest";

import {
  buildTimeline,
  createTimelinePlayer,
  dayNumber,
  eventsAfter,
  isoFromDay,
  todayIso,
} from "../src/js/timeline";

const park = (parkCode, visitedOn) => ({
  parkCode,
  visited: visitedOn ? 1 : 0,
  visitedOn,
});
const parks = [
  park("acad", ["2017-08-13"]),
  park("caco", ["2020-12-12", "2021-11-16", "2022-12-05"]),
  park("spar", ["2022-10-30", "2026-01-17"]),
  park("lowe", ["2022-08-15"]),
  park("mima", ["2022-08-15", "2020-03-21"]),
  park("yell", undefined),
];
const tl = buildTimeline(parks, { today: "2026-11-17" });

describe("dates", () => {
  it("round-trips day numbers without a time zone shift", () => {
    expect(isoFromDay(dayNumber("2024-02-29"))).toBe("2024-02-29");
    expect(dayNumber("2024-03-01") - dayNumber("2024-02-28")).toBe(2);
    expect(todayIso(new Date(2026, 10, 7, 23, 30))).toBe("2026-11-07");
  });
});

describe("buildTimeline", () => {
  it("has one event per visit date, oldest first, with first visits", () => {
    expect(tl.start).toBe("2017-08-13");
    expect(tl.end).toBe("2026-11-17");
    expect(tl.events.map((e) => e.date)).toEqual([
      "2017-08-13",
      "2020-03-21",
      "2020-12-12",
      "2021-11-16",
      "2022-08-15",
      "2022-10-30",
      "2022-12-05",
      "2026-01-17",
    ]);
    const aug = tl.events.find((e) => e.date === "2022-08-15");
    expect(aug.parks.map((p) => p.parkCode).sort()).toEqual(["lowe", "mima"]);
    // Minute Man was first visited in 2020, so only Lowell is new.
    expect(aug.newParks.map((p) => p.parkCode)).toEqual(["lowe"]);
    expect(tl.firstVisit.get("mima")).toBe("2020-03-21");
    expect(tl.firstVisit.has("yell")).toBe(false);
  });

  it("counts distinct parks by date", () => {
    expect(tl.countAt("2017-08-12")).toBe(0);
    expect(tl.countAt("2017-08-13")).toBe(1);
    expect(tl.countAt("2022-08-15")).toBe(4);
    expect(tl.countAt("2026-11-17")).toBe(5);
  });

  it("has a bar for every year, counting repeat visits", () => {
    expect(tl.years.map((y) => y.year)).toEqual([
      2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    expect(tl.years.find((y) => y.year === 2022).visits).toBe(4);
    expect(tl.years.find((y) => y.year === 2019).visits).toBe(0);
  });

  it("counts a year's visits up to a date", () => {
    expect(tl.visitsInYearAt(2022, "2022-08-15")).toBe(2);
    expect(tl.visitsInYearAt(2022, "2022-12-31")).toBe(4);
    expect(tl.visitsInYearAt(2022, "2026-01-01")).toBe(4);
    expect(tl.visitsInYearAt(2026, "2022-12-31")).toBe(0);
  });
});

describe("eventsAfter", () => {
  it("plays the rest, or everything again from the end", () => {
    const rest = eventsAfter(tl, "2022-08-15");
    expect(rest.restart).toBe(false);
    expect(rest.events.map((e) => e.date)).toEqual([
      "2022-10-30",
      "2022-12-05",
      "2026-01-17",
    ]);
    const again = eventsAfter(tl, tl.end);
    expect(again.restart).toBe(true);
    expect(again.events).toHaveLength(tl.events.length);
  });
});

describe("createTimelinePlayer", () => {
  it("steps every event and reports state", async () => {
    const seen = [];
    const onState = vi.fn();
    const player = createTimelinePlayer({
      step: async (e) => seen.push(e.date),
      onState,
    });
    expect(await player.play(tl.events.slice(0, 3))).toBe(true);
    expect(seen).toEqual(["2017-08-13", "2020-03-21", "2020-12-12"]);
    expect(onState.mock.calls).toEqual([[true], [false]]);
  });

  it("stop pauses where it is", async () => {
    const seen = [];
    let release;
    const player = createTimelinePlayer({
      step: (e) => {
        seen.push(e.date);
        return new Promise((resolve) => (release = resolve));
      },
    });
    const run = player.play(tl.events);
    player.stop();
    release();
    expect(await run).toBe(false);
    expect(seen).toEqual(["2017-08-13"]);
    expect(player.isPlaying()).toBe(false);
  });

  it("an interrupted step pauses", async () => {
    const player = createTimelinePlayer({
      step: () => Promise.reject(new Error("interrupted")),
    });
    expect(await player.play(tl.events)).toBe(false);
    expect(player.isPlaying()).toBe(false);
  });
});
