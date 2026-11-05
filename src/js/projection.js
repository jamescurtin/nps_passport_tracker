// Map projection setup, shared by src/index.js and test/projection.test.js.
// Nothing here touches the DOM, so the module stays testable in node.

import { geoPath } from "d3";
// UMD package that marks itself __esModule: the named import resolves under
// both webpack and vitest (a default import is undefined under webpack).
import { geoAlbersUsaTerritories } from "geo-albers-usa-territories";

// Gap between the map and the container edge, in px.
export const MAP_PADDING = 12;

/**
 * Build an Albers USA (with territories) projection that fits `features`
 * inside the container with MAP_PADDING on every side. The composite
 * projection has no fitExtent(), so this applies d3-geo's fit algorithm:
 * every sub-projection's translate and clip extent is linear in the scale,
 * so one measuring pass at a reference scale is exact.
 * @param {number} width - Container width in px
 * @param {number} height - Container height in px
 * @param {object} features - GeoJSON FeatureCollection (or any GeoJSON)
 * @return {Function} The fitted projection
 */
export function fitProjection(width, height, features) {
  const projection = geoAlbersUsaTerritories();
  const x0 = MAP_PADDING;
  const y0 = MAP_PADDING;
  const w = Math.max(1, width - 2 * MAP_PADDING);
  const h = Math.max(1, height - 2 * MAP_PADDING);
  const referenceScale = 150;
  projection.scale(referenceScale).translate([0, 0]);
  const [[bx0, by0], [bx1, by1]] = geoPath(projection).bounds(features);
  const k = Math.min(w / (bx1 - bx0), h / (by1 - by0));
  return projection
    .scale(referenceScale * k)
    .translate([
      x0 + (w - k * (bx1 + bx0)) / 2,
      y0 + (h - k * (by1 + by0)) / 2,
    ]);
}
