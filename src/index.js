import * as d3 from "d3";
import * as topojson from "topojson-client";
import topoJsonStates from "us-atlas/states-10m";

import parksJSON from "./data/parks";
import visitsJSON from "./data/visits";

import { list as listIcon, chevron } from "./js/icons";
import { createLegend } from "./js/legend";
import { announce } from "./js/live";
import { clickedPoint } from "./js/modal";
import { renderParkRows } from "./js/park_row";
import { createSheet, closeTopSheet } from "./js/sheet";
import stateAbbreviations from "./js/state_abbreviations";
import { ParkSearch, createSearchUI } from "./js/search";
import { calculateStats, createStatsButton } from "./js/statistics";

import "./css/index.css";

// Modified version of geo-albers-usa that includes projections for all US territories
const geoAlbersUsaTerritories = require("geo-albers-usa-territories");

// Selector for active state when zoomed
let active = d3.select(null);

// Name of the zoomed state, for the toolbar label and announcements.
let activeStateName = "";

// Search UI handle (set once data loads); its sheet closes on state zoom.
let searchUI = null;

// Search overlay elements
let searchCircle = null;
let addressPin = null;
let currentSearchLocation = null;

// Media queries, read once. `mobileQuery` also drives the resize path.
const mobileQuery = window.matchMedia("(max-width: 768px)");
const hoverNoneQuery = window.matchMedia("(hover: none)");
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

// SVG container properties - sized from #map-container so the header and
// toolbar (which the container reserves space for) never overlap the map.
const mapContainer = document.getElementById("map-container");
const measureMap = () => {
  const rect = mapContainer.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
};
let { width, height } = measureMap();
// Use smaller scale on mobile to prevent map from being cut off
const getMapScale = () => {
  const baseScale = mobileQuery.matches ? 1.2 : 1.5;
  return Math.min(width, height) * baseScale;
};
let scale = getMapScale();
const borderRadius = 5;

// NPS Site point marker properties
const pointRadius = 3;
// Radius of the invisible touch target around each marker (px at k=1)
const hitRadius = 12;
// White ring around not-visited dots (px at k=1)
const dotStrokeWidth = 1;
// Interior (mesh) and outer (outline) border widths at k=1
const outlineWidth = 0.6;

// Zoom scale bounds, shared by the zoom behavior and programmatic zooms.
const MIN_SCALE = 1;
const MAX_SCALE = 16;

// On click properties
const tooltipOpacity = 0.9;
const zoomDuration = reduceMotion ? 0 : 750;
const mouseoverDuration = reduceMotion ? 0 : 200;
const highlightDuration = reduceMotion ? 0 : 150;
const TOOLTIP_OFFSET = 12;
const TOOLTIP_MARGIN = 4;

// Map properties
const strokeWidth = 0.25;
const mapTitle = "James & Elize's National Park Trips";
let projection = geoAlbersUsaTerritories
  .geoAlbersUsaTerritories()
  .scale(scale)
  .translate([width / 2, height / 2]);
let path = d3.geoPath(projection);

// Page shell lives in src/index.html
const body = d3.select("body");
const header = d3.select(".app-bar");
const sheets = d3.select("#sheets");

const tooltip = body
  .append("div")
  .attr("class", "tooltip")
  .attr("role", "tooltip")
  .attr("aria-hidden", "true")
  .style("opacity", 0);
const svg = d3
  .select("#map-container")
  .append("svg")
  .classed("svg-content-responsive", true)
  .attr("width", width)
  .attr("height", height)
  .style("border-radius", `${borderRadius}px`);

svg
  .append("rect")
  .attr("class", "background")
  .attr("width", width)
  .attr("height", height)
  .on("click", resetMap);
const g = svg.append("g");

// Create zoom behavior for pinch-to-zoom and pan on mobile
// Extended max zoom (16x) to handle small states like DC
const zoom = d3
  .zoom()
  .scaleExtent([MIN_SCALE, MAX_SCALE])
  .on("zoom", (event) => {
    g.attr("transform", event.transform);

    // Adjust stroke widths and point sizes based on zoom level
    const k = event.transform.k;
    g.selectAll(".mesh").attr("stroke-width", strokeWidth / k);
    g.selectAll(".outline").attr("stroke-width", outlineWidth / k);
    // Highlighted markers keep their enlarged radius and 2px ring.
    g.selectAll(".park-dot")
      .attr("r", function () {
        return (isHighlightedDot(this) ? pointRadius * 2.5 : pointRadius) / k;
      })
      .attr("stroke-width", function () {
        return (isHighlightedDot(this) ? 2 : dotStrokeWidth) / k;
      });
    g.selectAll(".park-hit").attr("r", hitRadius / k);
    // Touch hit circles are only active when zoomed (pinch does not set `active`).
    svg.classed("zoomed", k >= 2);

    // Counter-scale search overlay elements
    if (searchCircle) {
      searchCircle.attr("stroke-width", 1.5 / k);
    }
    if (addressPin) {
      addressPin.attr("r", 6 / k).attr("stroke-width", 2 / k);
    }
  });

// Apply zoom to SVG (but filter out click events to allow state clicking)
svg.call(zoom).on("dblclick.zoom", null);

const parksButton = d3
  .select("#slot-parks")
  .append("button")
  .attr("type", "button")
  .attr("class", "toolbar-btn parks-in-state-toggle")
  .attr("hidden", "")
  .html(`${listIcon}<span class="btn-label">Parks in State</span>`)
  .on("click", openStateList);

// Park list for the active state. Content is filled by clickedMap; the
// toolbar "Parks in State" button opens it.
const stateSheet = createSheet({
  id: "state-park-list",
  title: "Parks in State",
  className: "state-sheet",
  parent: sheets.node(),
  // A user close (button, Escape, backdrop, drag) brings the Parks button
  // back while a state is still active, before the sheet restores focus to it.
  onClose: () => {
    if (active.node()) parksButton.attr("hidden", null);
  },
});

const loadingIndicator = body
  .append("div")
  .attr("class", "loading-indicator")
  .attr("id", "loading-indicator")
  .text("Loading map…");

Promise.all([d3.json(topoJsonStates), d3.json(parksJSON), d3.json(visitsJSON)])
  .then(function ([json, parkData, visitData]) {
    loadingIndicator.remove();
    const data = mergeNPSData(parkData, visitData);
    const features = topojson.feature(json, json.objects.states).features;

    const parksVisitedCount = countParksVisited(data);
    const percentVisited = Math.round((parksVisitedCount / data.length) * 100);

    header.append("h1").text(mapTitle);
    const countPill = header
      .append("button")
      .attr("type", "button")
      .attr("class", "count-pill")
      .attr("popovertarget", "legend-popover");
    countPill
      .append("span")
      .text(`Visited ${parksVisitedCount} NPS Units (${percentVisited}%)`);
    countPill.append("span").attr("class", "count-pill-chevron").html(chevron);

    // Add NPS sites as properties of the states they are located within
    for (let i = 0; i < features.length; i++) {
      features[i].properties.parks = [];
      for (let j = 0; j < data.length; j++) {
        if (
          data[j].states.includes(
            stateAbbreviations[features[i].properties.name],
          )
        ) {
          features[i].properties.parks.push(data[j]);
        }
      }
    }

    const mesh = topojson.mesh(json, json.objects.states, function (a, b) {
      return a !== b;
    });

    g.selectAll("path")
      .data(features)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("class", function (d) {
        let visit_count = d.properties.parks.reduce(
          (count, park) => count + parseInt(park.visited),
          0,
        );
        let parks_in_state = d.properties.parks.length;
        // A state with no NPS sites is not "complete" (0 === 0 would
        // otherwise mark it green).
        return parks_in_state > 0 && visit_count === parks_in_state
          ? "state-complete"
          : "state";
      })
      .on("mouseover", (event, d) => showTooltip(event, d.properties.name))
      .on("mouseout", hideTooltip)
      .on("click", clickedMap);

    g.append("path")
      .datum(mesh)
      .attr("class", "mesh")
      .attr("stroke-width", strokeWidth)
      .attr("d", path);

    // Outer country outline: edges that belong to exactly one state.
    const outline = topojson.mesh(json, json.objects.states, (a, b) => a === b);
    g.append("path")
      .datum(outline)
      .attr("class", "outline")
      .attr("stroke-width", outlineWidth)
      .attr("d", path);

    const markers = g
      .selectAll(".park-marker")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "park-marker")
      .attr("transform", markerTransform)
      .on("mouseover", (event, d) => showTooltip(event, d.name))
      .on("mouseout", hideTooltip)
      .on("click", clickedPoint);
    markers
      .append("circle")
      .attr("class", (d) => (d.visited ? "park-dot" : "park-dot not-visited"))
      .attr("r", pointRadius)
      .attr("stroke-width", dotStrokeWidth);
    // Transparent touch target; CSS enables it only on coarse pointers.
    markers.append("circle").attr("class", "park-hit").attr("r", hitRadius);

    // Function to zoom to a state by abbreviation
    const zoomToStateByAbbrev = (stateAbbrev) => {
      // Find the state feature by abbreviation
      const stateFeature = features.find(
        (f) => stateAbbreviations[f.properties.name] === stateAbbrev,
      );
      if (stateFeature) {
        // Find the corresponding DOM element
        const stateElement = g
          .selectAll(".state, .state-complete")
          .filter((d) => d === stateFeature)
          .node();
        if (stateElement) {
          // Simulate a click on the state
          clickedMap.call(stateElement, null, stateFeature);
        }
      }
    };

    // Function to zoom to a location with a given radius
    const zoomToLocation = (lat, lng, radiusMiles) => {
      // Clear signal from search panel
      if (lat === null) {
        clearSearchOverlay();
        return;
      }

      // Project the center point
      const center = projection([lng, lat]);
      if (!center) return; // Location outside projection bounds

      // Calculate scale based on radius
      // We want the radius to fit within ~40% of the smaller screen dimension
      const targetPixels = Math.min(width, height) * 0.4;
      const radiusPixels = searchRadiusPixels(lat, lng, radiusMiles);
      if (radiusPixels === 0) return;

      // Calculate scale so that radius fits in targetPixels
      const desiredScale = targetPixels / radiusPixels;
      const clampedScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, desiredScale),
      );

      // Calculate translation to center the point
      const translate = [
        width / 2 - clampedScale * center[0],
        height / 2 - clampedScale * center[1],
      ];

      // Apply the zoom transform
      const transform = d3.zoomIdentity
        .translate(translate[0], translate[1])
        .scale(clampedScale);

      svg.transition().duration(zoomDuration).call(zoom.transform, transform);

      // Draw search overlay (pin + circle)
      drawSearchOverlay(lat, lng, radiusMiles);
    };

    // Initialize search functionality
    const parkSearch = new ParkSearch(
      data,
      (filteredParks) => {
        // Update map to highlight/dim parks based on filter
        g.selectAll(".park-marker")
          .style("opacity", (d) => (filteredParks.includes(d) ? 1 : 0.2))
          .classed("filtered-out", (d) => !filteredParks.includes(d));
        announceResults(filteredParks.length, data.length);
      },
      zoomToStateByAbbrev,
      zoomToLocation,
    );

    // Attach highlight callbacks for hover
    parkSearch.onHighlightPark = highlightParkMarker;
    parkSearch.onUnhighlightPark = unhighlightParkMarker;

    // Open the park modal when a search result is clicked
    parkSearch.onParkSelect = (park, event) => clickedPoint(event, park);

    // Create search UI
    searchUI = createSearchUI(sheets, parkSearch, d3.select("#slot-search"));

    // Legend popover: rows toggle the visited filter, kept in sync with the
    // search sheet's segmented control through the ParkSearch change callback.
    const legend = createLegend({
      trigger: countPill.node(),
      popover: document.getElementById("legend-popover"),
      visited: parksVisitedCount,
      total: data.length,
      onSelect: (value) => parkSearch.setVisitedFilter(value),
    });
    parkSearch.onVisitedChange(legend.setActive);

    // Calculate and create stats button
    const stats = calculateStats(data, visitData);
    createStatsButton(sheets, stats, d3.select("#slot-stats"));
  })
  .catch(function (error) {
    console.error("Failed to load map data:", error);
    loadingIndicator.classed("error", true).text("Could not load map data. ");
    loadingIndicator
      .append("button")
      .attr("type", "button")
      .attr("class", "retry-button")
      .text("Retry")
      .on("click", () => window.location.reload());
  });

/**
 * Compute the on-screen pixel radius for a search circle of the given radius
 * in miles, centered at (lat, lng), under the current projection.
 *
 * Longitude degrees shrink with latitude, so the east/west offset must be
 * divided by cos(lat); a flat 1/69 deg/mi draws a circle that is too small
 * away from the equator (badly so for Alaska) and no longer matches the
 * haversine distance filter used to select parks.
 *
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radiusMiles - Radius in miles
 * @returns {number} Radius in projected pixels, or 0 if not projectable
 */
function searchRadiusPixels(lat, lng, radiusMiles) {
  const center = projection([lng, lat]);
  if (!center) return 0;
  const milesPerDegreeLat = 69;
  const lngDegrees =
    radiusMiles / (milesPerDegreeLat * Math.cos((lat * Math.PI) / 180));
  const edgePoint = projection([lng + lngDegrees, lat]);
  if (!edgePoint) return 0;
  return Math.abs(edgePoint[0] - center[0]);
}

/**
 * Draw a search overlay on the map showing address pin and search radius circle.
 * @param {number} lat - Latitude of the address
 * @param {number} lng - Longitude of the address
 * @param {number} radiusMiles - Search radius in miles
 */
function drawSearchOverlay(lat, lng, radiusMiles) {
  clearSearchOverlay();
  currentSearchLocation = { lat, lng, radiusMiles };

  const center = projection([lng, lat]);
  if (!center) return;

  const radiusPixels = searchRadiusPixels(lat, lng, radiusMiles);
  if (radiusPixels === 0) return;

  // Get current zoom scale
  const k = d3.zoomTransform(svg.node()).k;

  // Semi-transparent green circle behind park markers
  searchCircle = g
    .insert("circle", ".park-marker")
    .attr("class", "search-circle")
    .attr("cx", center[0])
    .attr("cy", center[1])
    .attr("r", radiusPixels)
    .attr("stroke-width", 1.5 / k);

  // Red pin on top of everything
  addressPin = g
    .append("circle")
    .attr("class", "address-pin")
    .attr("cx", center[0])
    .attr("cy", center[1])
    .attr("r", 6 / k)
    .style("stroke", "var(--surface)")
    .attr("stroke-width", 2 / k);

  applyOverlayColors();
}

/**
 * Apply theme colors to the search overlay (circle and address pin).
 * Uses CSS variables so the theme switch needs no JS repaint.
 */
function applyOverlayColors() {
  if (searchCircle) {
    searchCircle
      .style("fill", "var(--visited)")
      .style("fill-opacity", 0.12)
      .style("stroke", "var(--visited)");
  }
  if (addressPin) {
    addressPin.style("fill", "var(--danger)");
  }
}

/**
 * Remove search overlay elements from the map.
 */
function clearSearchOverlay() {
  if (searchCircle) {
    searchCircle.remove();
    searchCircle = null;
  }
  if (addressPin) {
    addressPin.remove();
    addressPin = null;
  }
  currentSearchLocation = null;
}

/**
 * Whether a park-dot belongs to a highlighted marker.
 * @param {Element} dot - The .park-dot element
 * @return {boolean} true if highlighted
 */
function isHighlightedDot(dot) {
  return dot.parentNode.classList.contains("highlighted");
}

/**
 * Highlight a park marker on the map by parkCode.
 * @param {string} parkCode - The park code to highlight
 */
function highlightParkMarker(parkCode) {
  const k = d3.zoomTransform(svg.node()).k;
  const marker = g
    .selectAll(".park-marker")
    .filter((d) => d.parkCode === parkCode)
    .classed("highlighted", true)
    .raise();
  marker
    .select(".park-dot")
    .transition()
    .duration(highlightDuration)
    .attr("r", (pointRadius * 2.5) / k)
    .attr("stroke-width", 2 / k);
}

/**
 * Remove highlight from a park marker on the map by parkCode.
 * @param {string} parkCode - The park code to unhighlight
 */
function unhighlightParkMarker(parkCode) {
  const k = d3.zoomTransform(svg.node()).k;
  g.selectAll(".park-marker")
    .filter((d) => d.parkCode === parkCode)
    .classed("highlighted", false)
    .select(".park-dot")
    .transition()
    .duration(highlightDuration)
    .attr("r", pointRadius / k)
    .attr("stroke-width", dotStrokeWidth / k);
}

/**
 * Update map upon click.
 * @param {object} _ - The event callback.
 * @param {object} d - The object clicked.
 * @return {undefined}
 */
function clickedMap(_, d) {
  if (active.node() === this) return resetMap();
  active.classed("active", false);
  active = d3.select(this).classed("active", true);
  // Dim every other state instead of recoloring the active one.
  g.selectAll(".state, .state-complete").classed(
    "dimmed",
    (_d, i, nodes) => nodes[i] !== this,
  );

  const bounds = path.bounds(d);
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;
  const scale = 0.9 / Math.max(dx / width, dy / height);
  // Clamp to the zoom behavior's scale extent and drive the zoom through it so
  // its stored transform stays in sync. Otherwise a subsequent drag/pan starts
  // from the stale (identity) transform and snaps the map back to full country.
  const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const translate = [
    width / 2 - clampedScale * x,
    height / 2 - clampedScale * y,
  ];
  const transform = d3.zoomIdentity
    .translate(translate[0], translate[1])
    .scale(clampedScale);

  // The zoom "on('zoom')" handler counter-scales the mesh, markers, and search
  // overlay for each interpolated transform during this transition.
  svg.transition().duration(zoomDuration).call(zoom.transform, transform);

  // Close search panel when zooming (but keep toggle visible)
  if (searchUI) searchUI.sheet.close({ restoreFocus: false });

  closeStateList({ restoreFocus: false });
  activeStateName = d.properties.name;
  parksButton.select(".btn-label").text(`Parks in ${activeStateName}`);
  parksButton.attr("hidden", null);
  renderStateList(d);
}

/**
 * Announce the number of parks that match the current filters.
 * @param {number} matching - Parks passing every filter
 * @param {number} total - All parks
 */
function announceResults(matching, total) {
  announce(
    matching === total
      ? `All ${total} parks shown`
      : `${matching} ${matching === 1 ? "park matches" : "parks match"}`,
  );
}

/**
 * Fill the state park list sheet for a state feature.
 * @param {object} d - State feature with `properties.parks`
 */
function renderStateList(d) {
  const parks = d.properties.parks;
  const visited = countParksVisited(parks);
  stateSheet.setTitle(d.properties.name);

  const summary = d3.select(stateSheet.header);
  summary.selectAll("*").remove();
  summary
    .append("p")
    .attr("class", "progress-label")
    .text(`${visited} of ${parks.length} visited`);
  summary
    .append("div")
    .attr("class", "progress")
    .attr("role", "progressbar")
    .attr("aria-label", "Parks visited")
    .attr("aria-valuemin", 0)
    .attr("aria-valuemax", parks.length)
    .attr("aria-valuenow", visited)
    .append("div")
    .attr("class", "progress-fill")
    .style("width", `${parks.length ? (visited / parks.length) * 100 : 0}%`);

  renderParkRows(d3.select(stateSheet.body), parks, {
    name: (park) => park.fullName,
    secondaryText: (park) =>
      park.visited ? park.visitedOn.join(", ") : "Not visited",
    emptyMessage: "No NPS sites in this state.",
    onSelect: (park, event) => clickedPoint(event, park),
  });
  stateSheet.body.scrollTop = 0;
}

/**
 * Reset map when clicking off main projection.
 * @return {undefined}
 */
function resetMap() {
  active.classed("active", false);
  active = d3.select(null);
  g.selectAll(".dimmed").classed("dimmed", false);

  // Reset d3 zoom transform
  svg.transition().duration(zoomDuration).call(zoom.transform, d3.zoomIdentity);

  g.transition()
    .duration(zoomDuration)
    .style("stroke-width", strokeWidth)
    .attr("transform", "");

  g.selectAll(".mesh")
    .transition()
    .duration(zoomDuration)
    .attr("stroke-width", strokeWidth);

  g.selectAll(".outline")
    .transition()
    .duration(zoomDuration)
    .attr("stroke-width", outlineWidth);

  g.selectAll(".park-dot")
    .transition()
    .duration(zoomDuration)
    .attr("r", pointRadius)
    .attr("stroke-width", dotStrokeWidth);

  g.selectAll(".park-hit")
    .transition()
    .duration(zoomDuration)
    .attr("r", hitRadius);

  // Restore search overlay elements to default scale
  if (searchCircle) {
    searchCircle.transition().duration(zoomDuration).attr("stroke-width", 1.5);
  }
  if (addressPin) {
    addressPin
      .transition()
      .duration(zoomDuration)
      .attr("r", 6)
      .attr("stroke-width", 2);
  }

  parksButton.attr("hidden", "");
  closeStateList({ restoreFocus: false });
}

// Debounce helper function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * SVG transform that places a park marker group at its projected position.
 * @param {object} d - Park datum with longitude and latitude
 * @return {string} translate() transform
 */
function markerTransform(d) {
  const [x, y] = projection([d.longitude, d.latitude]);
  return `translate(${x},${y})`;
}

/**
 * Show the tooltip near the pointer, clamped inside the viewport.
 * Skipped on devices without hover (touch).
 * @param {MouseEvent} event - The mouseover event
 * @param {string} text - Tooltip text
 */
function showTooltip(event, text) {
  if (hoverNoneQuery.matches) return;
  // Reset position first so a previous near-edge position cannot wrap the text.
  tooltip
    .text(text)
    .attr("aria-hidden", "false")
    .style("left", "0px")
    .style("top", "0px");
  const rect = tooltip.node().getBoundingClientRect();
  const maxLeft = document.documentElement.clientWidth - rect.width;
  const maxTop = document.documentElement.clientHeight - rect.height;
  const left = Math.max(
    TOOLTIP_MARGIN,
    Math.min(event.clientX + TOOLTIP_OFFSET, maxLeft - TOOLTIP_MARGIN),
  );
  const top = Math.max(
    TOOLTIP_MARGIN,
    Math.min(event.clientY + TOOLTIP_OFFSET, maxTop - TOOLTIP_MARGIN),
  );
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
  tooltip
    .transition()
    .duration(mouseoverDuration)
    .style("opacity", tooltipOpacity);
}

/**
 * Hide the tooltip.
 */
function hideTooltip() {
  tooltip.attr("aria-hidden", "true");
  tooltip.transition().duration(mouseoverDuration).style("opacity", 0);
}

// Handle window resize for responsive map
const handleResize = debounce(() => {
  ({ width, height } = measureMap());
  scale = getMapScale();

  // Update projection
  projection = geoAlbersUsaTerritories
    .geoAlbersUsaTerritories()
    .scale(scale)
    .translate([width / 2, height / 2]);
  path = d3.geoPath(projection);

  // Update SVG dimensions
  svg.attr("width", width).attr("height", height);

  // Update background rect
  svg.select(".background").attr("width", width).attr("height", height);

  // Redraw all paths
  g.selectAll("path").attr("d", path);

  // Reposition markers
  g.selectAll(".park-marker").attr("transform", markerTransform);

  // Reposition search overlay if active
  if (currentSearchLocation) {
    const loc = currentSearchLocation;
    const center = projection([loc.lng, loc.lat]);
    if (center) {
      const radiusPixels = searchRadiusPixels(
        loc.lat,
        loc.lng,
        loc.radiusMiles,
      );

      if (searchCircle) {
        searchCircle
          .attr("cx", center[0])
          .attr("cy", center[1])
          .attr("r", radiusPixels);
      }
      if (addressPin) {
        addressPin.attr("cx", center[0]).attr("cy", center[1]);
      }
    }
  }

  // Reset map view if zoomed
  if (active.node()) {
    resetMap();
  }
}, 150);

window.addEventListener("resize", handleResize);
mobileQuery.addEventListener("change", handleResize);

// Escape closes the innermost open sheet. preventDefault stops the native
// <dialog> close request from also closing the next modal sheet down.
document.addEventListener("keydown", (event) => {
  // An open popover takes Escape first (native light dismiss).
  if (
    event.key === "Escape" &&
    !document.querySelector(":popover-open") &&
    closeTopSheet()
  ) {
    event.preventDefault();
  }
});

/**
 * Merge data from parks visited with all parks
 * @param {object} parkData - JSON data for all national parks
 * @param {object} visitData - JSON data for parks that have been visited
 * @return {object} merged data
 */
function mergeNPSData(parkData, visitData) {
  const data = [];
  for (let i = 0; i < parkData.length; i++) {
    const park = parkData[i];
    park.visited = 0;
    for (let j = 0; j < visitData.length; j++) {
      const visit = visitData[j];
      if (park.parkCode == visit.parkCode) {
        park.visited = 1;
        park.visitedOn = visit.visitedOn;
        park.notes = visit.notes;
      }
    }
    data.push(park);
  }
  return data;
}

/**
 * Count the number of parks that have been visited
 * @param {object} parks - JSON data for all national parks
 * @return {int} Number of parks visited
 */
function countParksVisited(parks) {
  return parks.map((i) => i.visited).reduce((a, b) => a + b, 0);
}

/**
 * Open the state park list and hide the toolbar button that opened it.
 */
function openStateList() {
  announce(`Parks in ${activeStateName}`, 100);
  parksButton.attr("hidden", "");
  stateSheet.open({ opener: parksButton.node() });
}

/**
 * Close the state park list without user intent (zoom change, reset).
 * The Parks button visibility is the caller's decision.
 * @param {object} [options]
 * @param {boolean} [options.restoreFocus=false] - Refocus the Parks button
 */
function closeStateList({ restoreFocus = false } = {}) {
  stateSheet.close({ reason: "program", restoreFocus });
}
