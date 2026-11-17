import { describe, it, expect } from "vitest";
import { geoPath } from "d3";
import * as topojson from "topojson-client";
import topology from "us-atlas/states-10m.json";

import { fitProjection, transformForBounds } from "../src/js/projection";

// The same FeatureCollection src/index.js draws (states plus territories).
const states = topojson.feature(topology, topology.objects.states);

const SIZES = [
  [390, 760], // portrait phone
  [760, 390], // landscape phone
  [1440, 900], // desktop
  [320, 568], // small phone
];

describe("fitProjection", () => {
  it("draws every state and territory", () => {
    expect(states.features.length).toBeGreaterThanOrEqual(56);
  });

  it.each(SIZES)("keeps every feature inside %ix%i", (width, height) => {
    const path = geoPath(fitProjection(width, height, states));
    for (const feature of states.features) {
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      const name = feature.properties.name;
      // An unprojected feature has infinite bounds, which would pass below.
      for (const v of [x0, y0, x1, y1]) {
        expect(Number.isFinite(v), `${name} bounds are finite`).toBe(true);
      }
      expect(x0, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(y0, `${name} top`).toBeGreaterThanOrEqual(0);
      expect(x1, `${name} right`).toBeLessThanOrEqual(width);
      expect(y1, `${name} bottom`).toBeLessThanOrEqual(height);
    }
  });

  it("fills the limiting dimension up to the padding", () => {
    for (const [width, height] of SIZES) {
      const [[x0, y0], [x1, y1]] = geoPath(
        fitProjection(width, height, states),
      ).bounds(states);
      const slackX = width - 24 - (x1 - x0);
      const slackY = height - 24 - (y1 - y0);
      expect(Math.min(slackX, slackY)).toBeCloseTo(0, 3);
    }
  });
});

describe("transformForBounds", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 500 };

  it("centers the box and fits its limiting side", () => {
    const t = transformForBounds(
      [
        [100, 100],
        [200, 150],
      ],
      rect,
      { fill: 1 },
    );
    // Width 100 -> k 10; height 50 -> k 10: both sides limit.
    expect(t.k).toBe(10);
    expect(t.x + t.k * 150).toBe(500);
    expect(t.y + t.k * 125).toBe(250);
  });

  it("centers inside an offset rect", () => {
    const t = transformForBounds(
      [
        [0, 0],
        [10, 10],
      ],
      { x: 400, y: 0, width: 600, height: 500 },
      { fill: 1, maxScale: 2 },
    );
    expect(t.k).toBe(2);
    expect(t.x + t.k * 5).toBe(700);
  });

  it("clamps the scale and survives a single point", () => {
    const point = [
      [50, 50],
      [50, 50],
    ];
    const t = transformForBounds(point, rect, { minExtent: 4, maxScale: 16 });
    expect(t.k).toBe(16);
    expect(Number.isFinite(t.x)).toBe(true);
    const wide = transformForBounds(
      [
        [-5000, 0],
        [5000, 10],
      ],
      rect,
      { minScale: 1 },
    );
    expect(wide.k).toBe(1);
  });
});
