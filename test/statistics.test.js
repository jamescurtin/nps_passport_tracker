import { describe, it, expect } from "vitest";

import { calculateStats } from "../src/js/statistics";

const PARKS = [
  { parkCode: "yell", states: ["WY", "MT"], visited: 1 },
  { parkCode: "grca", states: ["AZ"], visited: 0 },
  { parkCode: "zion", states: ["UT"], visited: 1 },
];

const VISITS = [
  { parkCode: "yell", visitedOn: ["2019-06-01", "2021-07-15"] },
  { parkCode: "zion", visitedOn: ["2020-09-10"] },
];

describe("calculateStats", () => {
  it("counts visited parks and percentage", () => {
    const stats = calculateStats(PARKS, VISITS);
    expect(stats.totalParks).toBe(3);
    expect(stats.visitedCount).toBe(2);
    expect(stats.percentVisited).toBe(67);
  });

  it("tallies visits by year", () => {
    const stats = calculateStats(PARKS, VISITS);
    expect(stats.visitsByYear).toEqual({ 2019: 1, 2020: 1, 2021: 1 });
  });

  it("identifies repeat visits sorted by count", () => {
    const stats = calculateStats(PARKS, VISITS);
    expect(stats.repeatVisits).toHaveLength(1);
    expect(stats.repeatVisits[0].parkCode).toBe("yell");
    expect(stats.repeatVisits[0].visits).toBe(2);
  });

  it("lists fully explored states", () => {
    const stats = calculateStats(PARKS, VISITS);
    // UT, WY, MT are fully visited; AZ is not.
    expect(stats.completeStates.sort()).toEqual(["MT", "UT", "WY"]);
    expect(stats.completeStates).not.toContain("AZ");
  });

  it("reports first and last visit dates", () => {
    const stats = calculateStats(PARKS, VISITS);
    expect(stats.firstVisit).toBe("2019-06-01");
    expect(stats.lastVisit).toBe("2021-07-15");
  });
});
