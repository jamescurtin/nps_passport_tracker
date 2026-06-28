import { describe, it, expect } from "vitest";

import { ParkSearch, haversineDistance } from "../src/js/search";

const PARKS = [
  {
    parkCode: "yell",
    name: "Yellowstone",
    fullName: "Yellowstone National Park",
    states: ["WY", "MT", "ID"],
    visited: 1,
    latitude: 44.6,
    longitude: -110.5,
    url: "https://nps.gov/yell",
  },
  {
    parkCode: "grca",
    name: "Grand Canyon",
    fullName: "Grand Canyon National Park",
    states: ["AZ"],
    visited: 0,
    latitude: 36.1,
    longitude: -112.1,
    url: "https://nps.gov/grca",
  },
  {
    parkCode: "zion",
    name: "Zion",
    fullName: "Zion National Park",
    states: ["UT"],
    visited: 1,
    latitude: 37.3,
    longitude: -113.0,
    url: "https://nps.gov/zion",
  },
];

function makeSearch() {
  let lastFiltered = [];
  const search = new ParkSearch(PARKS, (filtered) => {
    lastFiltered = filtered;
  });
  return { search, getFiltered: () => lastFiltered };
}

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(40, -100, 40, -100)).toBe(0);
  });

  it("approximates a known long distance (NYC to LA ~2450 mi)", () => {
    const d = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });
});

describe("ParkSearch filtering", () => {
  it("filters by text query across name and state", () => {
    const { search, getFiltered } = makeSearch();
    search.setQuery("grand");
    expect(getFiltered().map((p) => p.parkCode)).toEqual(["grca"]);

    search.setQuery("ut");
    expect(getFiltered().map((p) => p.parkCode)).toEqual(["zion"]);
  });

  it("filters by visited state", () => {
    const { search, getFiltered } = makeSearch();
    search.setVisitedFilter(true);
    expect(
      getFiltered()
        .map((p) => p.parkCode)
        .sort(),
    ).toEqual(["yell", "zion"]);

    search.setVisitedFilter(false);
    expect(getFiltered().map((p) => p.parkCode)).toEqual(["grca"]);
  });

  it("filters by state abbreviation", () => {
    const { search, getFiltered } = makeSearch();
    search.setStateFilter("MT");
    expect(getFiltered().map((p) => p.parkCode)).toEqual(["yell"]);
  });

  it("hasActiveListFilter reflects non-location filters", () => {
    const { search } = makeSearch();
    expect(search.hasActiveListFilter()).toBe(false);
    search.setQuery("zion");
    expect(search.hasActiveListFilter()).toBe(true);
    search.clearFilters();
    expect(search.hasActiveListFilter()).toBe(false);
  });

  it("getUniqueStates returns sorted distinct states", () => {
    const { search } = makeSearch();
    expect(search.getUniqueStates()).toEqual(["AZ", "ID", "MT", "UT", "WY"]);
  });
});

describe("ParkSearch location filter", () => {
  it("returns only parks within the radius, sorted by distance", () => {
    const { search } = makeSearch();
    // Centered near Zion/Grand Canyon; Yellowstone is far north.
    search.setLocationFilter(37.0, -112.5, 200);
    const inRange = search.getParksInRange().map((p) => p.parkCode);
    expect(inRange).toContain("zion");
    expect(inRange).toContain("grca");
    expect(inRange).not.toContain("yell");
  });

  it("respects an active visited filter inside the radius", () => {
    const { search } = makeSearch();
    search.setVisitedFilter(true);
    search.setLocationFilter(37.0, -112.5, 200);
    const inRange = search.getParksInRange().map((p) => p.parkCode);
    expect(inRange).toEqual(["zion"]);
  });
});
