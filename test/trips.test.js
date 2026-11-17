import { readFileSync } from "node:fs";

import { describe, it, expect, vi } from "vitest";

import {
  buildTrips,
  formatDateRange,
  formatDay,
  tripSummary,
} from "../src/js/trips";

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), "utf8"),
  );
const trips = load("trips");
const parks = load("parks");
const visits = load("visits");
const parksByCode = new Map(parks.map((p) => [p.parkCode, p]));
const visitsByCode = new Map(visits.map((v) => [v.parkCode, v.visitedOn]));

describe("trips.json", () => {
  it("has unique, URL-safe ids", () => {
    const ids = trips.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("every trip has a name and at least two stops", () => {
    for (const trip of trips) {
      expect(trip.name, trip.id).toBeTruthy();
      expect(trip.stops.length, trip.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("every stop is a mapped park visited on that exact date", () => {
    for (const trip of trips) {
      for (const { parkCode, date } of trip.stops) {
        const where = `${trip.id}/${parkCode}`;
        expect(parksByCode.has(parkCode), where).toBe(true);
        expect(visitsByCode.get(parkCode), where).toContain(date);
      }
    }
  });

  it("stops are in date order and no park repeats within a trip", () => {
    for (const trip of trips) {
      const dates = trip.stops.map((s) => s.date);
      expect(dates, trip.id).toEqual([...dates].sort());
      const codes = trip.stops.map((s) => s.parkCode);
      expect(new Set(codes).size, trip.id).toBe(codes.length);
    }
  });

  it("no visit belongs to two trips", () => {
    const seen = new Map();
    for (const trip of trips) {
      for (const { parkCode, date } of trip.stops) {
        const key = `${parkCode}@${date}`;
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, trip.id);
      }
    }
  });
});

describe("buildTrips", () => {
  it("resolves parks, numbers stops, groups days, newest first", () => {
    const built = buildTrips(trips, parksByCode);
    expect(built).toHaveLength(trips.length);
    expect(built[0].start >= built[1].start).toBe(true);
    const ca = built.find((t) => t.id === "2023-05-california");
    expect(ca.start).toBe("2023-05-06");
    expect(ca.end).toBe("2023-05-14");
    expect(ca.stops.map((s) => s.number)).toEqual(
      ca.stops.map((_, i) => i + 1),
    );
    expect(ca.days.map((d) => d.date)).toEqual([
      "2023-05-06",
      "2023-05-07",
      "2023-05-08",
      "2023-05-10",
      "2023-05-12",
      "2023-05-13",
      "2023-05-14",
    ]);
    expect(ca.states).toEqual(["CA"]);
  });

  it("drops unknown parks and trips left with one stop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const built = buildTrips(
      [
        {
          id: "x",
          name: "X",
          stops: [
            { parkCode: "acad", date: "2017-08-13" },
            { parkCode: "zzzz", date: "2017-08-14" },
          ],
        },
      ],
      parksByCode,
    );
    expect(built).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("date formatting", () => {
  it("formats ranges", () => {
    expect(formatDateRange("2018-08-13", "2018-08-13")).toBe("Aug 13, 2018");
    expect(formatDateRange("2024-06-15", "2024-06-21")).toBe("Jun 15–21, 2024");
    expect(formatDateRange("2024-05-30", "2024-06-02")).toBe(
      "May 30 – Jun 2, 2024",
    );
    expect(formatDateRange("2024-12-30", "2025-01-02")).toBe(
      "Dec 30, 2024 – Jan 2, 2025",
    );
  });

  it("formats days without a time zone shift", () => {
    expect(formatDay("2024-06-15")).toBe("Sat, Jun 15");
    expect(formatDay("2026-11-08")).toBe("Sun, Nov 8");
  });

  it("summarises a trip", () => {
    const [nola] = buildTrips(
      trips.filter((t) => t.id === "2026-06-new-orleans"),
      parksByCode,
    );
    expect(tripSummary(nola)).toBe("Jun 27, 2026 · 2 sites");
  });
});
