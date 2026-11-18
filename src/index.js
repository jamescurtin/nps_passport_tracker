import * as d3 from "d3";
import * as topojson from "topojson-client";
import topoJsonStates from "us-atlas/states-10m";

import parksJSON from "./data/parks";
import tripsJSON from "./data/trips";
import visitsJSON from "./data/visits";

import { createLegend } from "./js/legend";
import {
  activateOnKey,
  markerLabel,
  stateLabel,
  syncMarkerTabindex,
} from "./js/keyboard";
import { announce } from "./js/live";
import { clickedPoint, closeParkSheet, onParkSheetChange } from "./js/modal";
import { renderParkRows } from "./js/park_row";
import { fitProjection, transformForBounds } from "./js/projection";
import { registerServiceWorker } from "./js/register_sw";
import { createRouter } from "./js/router";
import { createSheet, closeTopSheet, hasOpenSheet } from "./js/sheet";
import stateAbbreviations from "./js/state_abbreviations";
import { ParkSearch, createSearchUI } from "./js/search";
import { calculateStats, createStatsButton } from "./js/statistics";
import {
  buildTimeline,
  createTimelinePlayer,
  eventsAfter,
  isoFromDay,
  dayNumber,
} from "./js/timeline";
import { createTimelineUI } from "./js/timeline_ui";
import { createTripPlayer, planRuns } from "./js/trip_player";
import { buildTrips, createTripsUI, formatDay } from "./js/trips";

import "./css/index.css";

// Selector for active state when zoomed
let active = d3.select(null);

// Name of the zoomed state, for the toolbar label and announcements.
let activeStateName = "";

// Dedicated keyboard focus ring path for states (created once data loads).
let focusRing = null;

// Search UI handle (set once data loads); its sheet closes on state zoom.
let searchUI = null;

// Hash router (created once data loads); mirrors state zoom and the park
// sheet into the URL and applies URL changes to the UI.
let router = null;

// Trips UI handle, the map layer for the route, and the route player (set
// once data loads).
let tripsUI = null;
let tripLayer = null;
let tripPlayer = null;

// Timeline: model, sheet, player, the date shown, and each zoom-to-complete
// state's completion date (set once data loads).
let timeline = null;
let timelineUI = null;
let timelinePlayer = null;
let timelineDate = null;
let stateCompletion = new Map();

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
const borderRadius = 5;

// NPS Site point marker properties
const pointRadius = 3;
// Radius of the invisible touch target around each marker (px at k=1)
const hitRadius = 12;
// White ring around not-visited dots (px at k=1)
const dotStrokeWidth = 1;
// Interior (mesh) and outer (outline) border widths at k=1
const outlineWidth = 0.6;
// Trip route line width (px at every zoom level)
const tripLineWidth = 2.5;
// A trip fills this fraction of the visible map; its box is at least this
// many px at k=1 (about a mile), so two stops a block apart do not zoom to max.
const TRIP_FILL = 0.8;
const TRIP_MIN_EXTENT = 0.5;
// A trip overview is never tighter than this fraction of the map's shorter
// side at k=1 (about 5x zoom), so it keeps the broader picture. Stops that
// crowd together at that zoom get a close-up (see planRuns).
const TRIP_OVERVIEW_MIN_EXTENT = 0.15;
// Camera move into or out of a trip close-up, ms.
const TRIP_CAMERA_MS = 750;
// Timeline playback: pause per visit date, ms. The camera does not move.
const TIMELINE_DWELL_MS = 450;

// Zoom scale bounds. MAX_SCALE caps the state and location zooms; gestures
// and trip views may go further, so the National Mall's memorials separate.
const MIN_SCALE = 1;
const MAX_SCALE = 16;
const GESTURE_MAX_SCALE = 400;
// The timeline shrinks the whole map a little to keep it above its card.
const GESTURE_MIN_SCALE = 0.5;

// On click properties
const tooltipOpacity = 0.9;
const zoomDuration = reduceMotion ? 0 : 750;
const mouseoverDuration = reduceMotion ? 0 : 200;
const highlightDuration = reduceMotion ? 0 : 150;
const TOOLTIP_OFFSET = 12;
const TOOLTIP_MARGIN = 4;

// Map properties
const strokeWidth = 0.25;
// States and territories as one FeatureCollection; the projection is fit to
// it (set once data loads, reused on resize). At the zoom identity the whole
// collection fits inside the container.
let stateCollection = null;
let projection = null;
let path = null;

/**
 * Fit the projection to the current container size and the drawn states.
 */
function updateProjection() {
  projection = fitProjection(width, height, stateCollection);
  path = d3.geoPath(projection);
}

// Page shell lives in src/index.html
const body = d3.select("body");
const sheets = d3.select("#sheets");

const tooltip = body
  .append("div")
  .attr("class", "tooltip")
  .attr("role", "tooltip")
  .attr("aria-hidden", "true")
  // Map elements carry their own aria-labels, so the tooltip must not repeat.
  .attr("aria-live", "off")
  .style("opacity", 0);
const svg = d3
  .select("#map-container")
  .append("svg")
  .classed("svg-content-responsive", true)
  .attr("role", "group")
  .attr("aria-label", "Map of National Park Service sites")
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
  .scaleExtent([GESTURE_MIN_SCALE, GESTURE_MAX_SCALE])
  .on("zoom", (event) => {
    g.attr("transform", event.transform);
    // A pan or pinch during trip playback takes over: the route jumps to its
    // end state and the camera stays where the user put it.
    if (event.sourceEvent && tripPlayer?.isPlaying()) {
      tripPlayer.skip({ fit: false });
    }

    // Adjust stroke widths and point sizes based on zoom level
    const k = event.transform.k;
    g.selectAll(".mesh").attr("stroke-width", strokeWidth / k);
    g.selectAll(".outline").attr("stroke-width", outlineWidth / k);
    sizeDots(k);
    g.selectAll(".park-hit").attr("r", hitRadius / k);
    g.selectAll(".trip-leg, .trip-leg-ghost").attr(
      "stroke-width",
      tripLineWidth / k,
    );
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

// Rendered hidden by index.html; shown while a state is active.
const parksButton = d3
  .select(".parks-in-state-toggle")
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

// Loading and error states share one slot inside the map container.
const loadSlot = d3
  .select("#map-container")
  .append("div")
  .attr("class", "load-slot");

/**
 * Show the spinner in the load slot.
 */
function showLoading() {
  loadSlot.html("");
  loadSlot
    .append("div")
    .attr("class", "spinner")
    .attr("role", "status")
    .attr("aria-label", "Loading map");
}

/**
 * Show the error card with a Retry button in the load slot.
 * @param {Error} error - Failure to log
 * @param {boolean} [reload=false] - Retry reloads the page instead of
 *   re-fetching (used when rendering failed after the DOM was partly built)
 */
function showError(error, reload = false) {
  console.error("Failed to load map data:", error);
  loadSlot.html("");
  const card = loadSlot
    .append("div")
    .attr("class", "load-card")
    .attr("role", "alert");
  card.append("p").text("Could not load map data.");
  card
    .append("button")
    .attr("type", "button")
    .attr("class", "retry-button")
    .text("Retry")
    .on("click", reload ? () => window.location.reload() : loadData)
    .node()
    .focus();
}

/**
 * Enable the header pill and toolbar once data is in place.
 */
function markReady() {
  d3.select(".count-pill").property("disabled", false);
  d3.selectAll(".toolbar .toolbar-btn").property("disabled", false);
  d3.select(".toolbar").attr("aria-busy", "false");
}

/**
 * Fade the markers in with a short stagger so the whole sweep stays within
 * 600ms. Skipped under prefers-reduced-motion. The CSS animation leaves no
 * inline style behind, so the search filter's opacity applies afterwards.
 * @param {object} markers - d3 selection of .park-marker groups
 */
function fadeInMarkers(markers) {
  if (reduceMotion) return;
  const step = Math.min(1.5, 300 / Math.max(markers.size(), 1));
  markers
    .classed("fade-in", true)
    .style("--fade-delay", (d, i) => `${(i * step).toFixed(2)}ms`)
    .on("animationend.fade", function () {
      d3.select(this)
        .classed("fade-in", false)
        .style("--fade-delay", null)
        .on("animationend.fade", null);
    });
}

/**
 * Fetch map data and render it; show the error card on failure.
 */
function loadData() {
  showLoading();
  Promise.all([
    d3.json(topoJsonStates),
    d3.json(parksJSON),
    d3.json(visitsJSON),
    d3.json(tripsJSON),
  ]).then(
    (results) => {
      try {
        renderMap(results);
      } catch (error) {
        showError(error, true);
      }
    },
    (error) => showError(error),
  );
}

loadData();

/**
 * Build the map, search, legend and stats from the loaded data.
 * @param {Array} results - [topology, parks, visits, trips] JSON
 */
function renderMap([json, parkData, visitData, tripData]) {
  loadSlot.html("");
  const data = mergeNPSData(parkData, visitData);
  stateCollection = topojson.feature(json, json.objects.states);
  const features = stateCollection.features;
  updateProjection();

  const parksVisitedCount = countParksVisited(data);
  const percentVisited = Math.round((parksVisitedCount / data.length) * 100);

  // The pill is rendered by index.html with a skeleton label.
  const countPill = d3.select(".count-pill");
  countPill
    .select(".count-label")
    .classed("skeleton", false)
    .text(`Visited ${parksVisitedCount} NPS Units (${percentVisited}%)`);

  // Add NPS sites as properties of the states they are located within
  for (let i = 0; i < features.length; i++) {
    features[i].properties.parks = [];
    for (let j = 0; j < data.length; j++) {
      if (
        data[j].states.includes(stateAbbreviations[features[i].properties.name])
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
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-pressed", "false")
    .attr("aria-label", (d) => {
      const parks = d.properties.parks;
      return stateLabel(
        d.properties.name,
        countParksVisited(parks),
        parks.length,
      );
    })
    .on("mouseover", (event, d) => showTooltip(event, d.properties.name))
    .on("mouseout", hideTooltip)
    .on("click", clickedMap)
    .on("keydown", activateOnKey(activateStateFromKey))
    .on("focus", (event, d) => {
      showFocusRing(d);
      showTooltipForFocus(event, d.properties.name);
    })
    .on("blur", () => {
      hideFocusRing();
      hideTooltip();
    });

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

  // Keyboard focus ring for states. A stroke on the state path itself would
  // be half-covered by later-painted neighbours, and raising the path would
  // reorder the DOM (and the tab order), so a dedicated path is drawn on top.
  focusRing = g
    .append("path")
    .attr("class", "focus-ring")
    .attr("stroke-width", 2)
    .attr("display", "none");

  // Trip route, under the markers.
  tripLayer = g.append("g").attr("class", "trip-layer");

  const markers = g
    .selectAll(".park-marker")
    .data(data)
    .enter()
    .append("g")
    .attr("class", "park-marker")
    .attr("transform", markerTransform)
    .attr("data-park-code", (d) => d.parkCode)
    // Not a tab stop until its state is active (see syncActiveState).
    .attr("tabindex", -1)
    .attr("role", "button")
    .attr("aria-label", (d) => markerLabel(d.fullName, d.visited))
    .on("mouseover", (event, d) => showTooltip(event, d.name))
    .on("mouseout", hideTooltip)
    .on("click", clickedPoint)
    .on(
      "keydown",
      activateOnKey((event) =>
        clickedPoint(event, d3.select(event.currentTarget).datum()),
      ),
    )
    .on("focus", (event, d) => {
      // No raise: moving the node in the DOM would drop keyboard focus.
      highlightParkMarker(d.parkCode, { raise: false });
      showTooltipForFocus(event, d.name);
    })
    .on("blur", (event, d) => {
      unhighlightParkMarker(d.parkCode);
      hideTooltip();
    });
  markers
    .append("circle")
    .attr("class", (d) => (d.visited ? "park-dot" : "park-dot not-visited"))
    .attr("r", pointRadius)
    .attr("stroke-width", dotStrokeWidth);
  // Transparent touch target; CSS enables it only on coarse pointers.
  markers.append("circle").attr("class", "park-hit").attr("r", hitRadius);
  fadeInMarkers(markers);

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
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, desiredScale));

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

  tripsUI = createTripsUI({
    container: sheets,
    toolbar: d3.select("#slot-trips"),
    trips: buildTrips(tripData, new Map(data.map((p) => [p.parkCode, p]))),
    onShow: showTripOnMap,
    onHide: hideTripOnMap,
    onReplay: playTrip,
    onSkip: () => tripPlayer.skip(),
    onSelectStop: (park, event) => clickedPoint(event, park),
    onHighlight: highlightParkMarker,
    onUnhighlight: unhighlightParkMarker,
    // Search and trips share the bottom-left corner on desktop.
    onOpen: () => {
      searchUI?.sheet.close({ reason: "program", restoreFocus: false });
      closeTimeline();
    },
  });

  tripPlayer = makeTripPlayer();

  timeline = buildTimeline(data);
  stateCompletion = completionDates(features, timeline);
  timelinePlayer = createTimelinePlayer({
    step: timelineStep,
    onState: (playing) => timelineUI.setPlaying(playing),
  });
  timelineUI = createTimelineUI({
    container: sheets,
    toolbar: d3.select("#slot-timeline"),
    timeline,
    onScrub: (date) => {
      timelinePlayer.stop();
      applyTimelineDate(date);
    },
    onPlay: playTimeline,
    onPause: () => timelinePlayer.stop(),
    onOpen: showTimelineOnMap,
    // A user close leaves the timeline. Another sheet replacing the mobile
    // card ("program": a park card opened from a marker) keeps the view.
    onClose: (reason) => {
      if (reason !== "program") hideTimelineOnMap();
    },
  });

  router = createRouter({
    parkStates: (code) => {
      const park = data.find((p) => p.parkCode === code);
      if (!park) return null;
      // A park can span several states (Yellowstone): prefer the state whose
      // outline contains the park, then the rest in listed order.
      const containing = features.find((f) =>
        d3.geoContains(f, [park.longitude, park.latitude]),
      );
      const home = containing && stateAbbreviations[containing.properties.name];
      return home && park.states.includes(home)
        ? [home, ...park.states.filter((s) => s !== home)]
        : park.states;
    },
    hasState: (abbr) =>
      features.some((f) => stateAbbreviations[f.properties.name] === abbr),
    openPark: (code) =>
      clickedPoint(
        null,
        data.find((p) => p.parkCode === code),
      ),
    closePark: closeParkSheet,
    zoomState: zoomToStateByAbbrev,
    reset: resetMap,
    hasTrip: (id) => tripsUI.hasTrip(id),
    openTrip: (id) => tripsUI.show(id),
    closeTrip: closeTrip,
    openTimeline: () => {
      if (!timelineUI.sheet.isOpen()) timelineUI.open();
    },
    closeTimeline: closeTimeline,
  });
  onParkSheetChange(router.parkChanged);

  // Initialize search functionality
  const parkSearch = new ParkSearch(
    data,
    (filteredParks) => {
      // Update map to highlight/dim parks based on filter
      g.selectAll(".park-marker")
        .style("opacity", (d) => (filteredParks.includes(d) ? 1 : 0.2))
        .classed("filtered-out", (d) => !filteredParks.includes(d));
      syncActiveState();
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
  markReady();
  // Last: a deep link needs the map, search and sheets in place.
  router.start();
}

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
 * Radius multiplier for a park-dot: highlighted markers 2.5x, trip stops 2x,
 * parks the timeline just reached 1.7x.
 * @param {Element} dot - The .park-dot element
 * @return {number} 1 for a plain marker
 */
function dotScale(dot) {
  const classes = dot.parentNode.classList;
  if (classes.contains("highlighted")) return 2.5;
  if (classes.contains("trip-stop")) return 2;
  return classes.contains("tl-arrive") ? 1.7 : 1;
}

/**
 * Size every dot for zoom scale `k`: highlighted markers and trip stops keep
 * their enlarged radius and 2px ring.
 * @param {number} [k] - Zoom scale (default: the current one)
 */
function sizeDots(k = d3.zoomTransform(svg.node()).k) {
  g.selectAll(".park-dot")
    .attr("r", function () {
      return (pointRadius * dotScale(this)) / k;
    })
    .attr("stroke-width", function () {
      return (dotScale(this) > 1 ? 2 : dotStrokeWidth) / k;
    });
}

/**
 * The part of the map not covered by the open trips or timeline sheet, in
 * map px. The sheet is cut off the side that leaves the larger area: the
 * bottom for a bottom sheet or the wide timeline card, the left for the
 * trips card. Never less than a third of the map, so a tall sheet cannot
 * squeeze the fit to nothing.
 * @return {{x: number, y: number, width: number, height: number}} Rect
 */
function visibleMapRect() {
  const rect = { x: 0, y: 0, width, height };
  const sheet = [tripsUI?.sheet, timelineUI?.sheet].find((s) => s?.isOpen());
  if (!sheet) return rect;
  // offset* ignore the sheet's entry transform, unlike getBoundingClientRect.
  // Both the sheet and the map container are position: fixed, so their
  // offsets are viewport coordinates.
  const el = sheet.el;
  const leftCut = el.offsetLeft + el.offsetWidth - mapContainer.offsetLeft;
  const bottomCut = mapContainer.offsetTop + height - el.offsetTop;
  const keepWidth = Math.max(width / 3, width - leftCut);
  const keepHeight = Math.max(height / 3, height - bottomCut);
  if (keepWidth * height >= width * keepHeight) {
    rect.width = keepWidth;
    rect.x = width - keepWidth;
  } else {
    rect.height = keepHeight;
  }
  return rect;
}

/**
 * Zoom so every stop of a trip is visible beside the trips sheet.
 * @param {object} trip - Built trip
 */
function fitTrip(trip) {
  const transform = tripOverview(trip);
  if (!transform) return;
  svg.transition().duration(zoomDuration).call(zoom.transform, transform);
}

/**
 * The trip's overview: every stop beside the trips sheet, but never zoomed
 * in past TRIP_OVERVIEW_MIN_EXTENT.
 * @param {object} trip - Built trip
 * @return {object|null} d3 zoom transform
 */
function tripOverview(trip) {
  return parksTransform(
    trip.stops.map((s) => s.park),
    { minExtent: TRIP_OVERVIEW_MIN_EXTENT * Math.min(width, height) },
  );
}

/**
 * Zoom transform that fits trip stops beside the trips sheet.
 * @param {object[]} stops - Trip stops (`{ park }`)
 * @return {object|null} d3 zoom transform, or null if nothing projects
 */
function stopsTransform(stops) {
  return parksTransform(stops.map((s) => s.park));
}

/**
 * Zoom transform that fits parks beside the open sheet.
 * @param {object[]} parks - Parks with `latitude`/`longitude`
 * @param {object} [options]
 * @param {number} [options.minExtent] - Smallest box side, px at k=1
 * @param {number} [options.maxScale] - Closest zoom
 * @return {object|null} d3 zoom transform, or null if nothing projects
 */
function parksTransform(
  parks,
  { minExtent = TRIP_MIN_EXTENT, maxScale = GESTURE_MAX_SCALE } = {},
) {
  const points = parks
    .map((p) => projection([+p.longitude, +p.latitude]))
    .filter(Boolean);
  if (points.length === 0) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const bounds = [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
  const t = transformForBounds(bounds, visibleMapRect(), {
    fill: TRIP_FILL,
    minExtent,
    minScale: MIN_SCALE,
    maxScale,
  });
  return d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
}

/**
 * @param {object} trip - Built trip
 * @return {object} The trip's stop markers (d3 selection)
 */
function tripMarkers(trip) {
  const codes = new Set(trip.stops.map((s) => s.park.parkCode));
  return g.selectAll(".park-marker").filter((d) => codes.has(d.parkCode));
}

/**
 * The route player, wired to the map. Created once data loads.
 * @return {object} See createTripPlayer
 */
function makeTripPlayer() {
  const legNodes = () => tripLayer.selectAll(".trip-leg").nodes();
  // Projected (k=1) length of each leg, measured on the drawn path.
  const legLength = (i) => legNodes()[i]?.getTotalLength() ?? 0;
  const runStops = (trip, run) =>
    trip.stops.slice(run.legs[0], run.legs[run.legs.length - 1] + 2);
  const runTransform = (trip, run) =>
    run ? stopsTransform(runStops(trip, run)) : tripOverview(trip);
  return createTripPlayer({
    plan: (trip) => {
      const k = tripOverview(trip)?.k ?? 1;
      return planRuns(trip.stops.slice(1).map((_, i) => legLength(i) * k));
    },
    runLength: (trip, run) => {
      const k = runTransform(trip, run.closeUp ? run : null)?.k ?? 1;
      return run.legs.reduce((sum, i) => sum + legLength(i), 0) * k;
    },
    // Default-named transition: a d3-zoom gesture or any other zoom
    // transition interrupts it (the gesture also skips, see the zoom handler).
    camera: (trip, run) => {
      const transform = runTransform(trip, run);
      if (!transform) return Promise.resolve();
      return svg
        .transition()
        .duration(TRIP_CAMERA_MS)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, transform)
        .end();
    },
    // One linear transition across the run's legs, so the pen moves at a
    // steady speed through every stop instead of easing in and out of each.
    drawRun: (run, ms, onReach) => {
      const nodes = run.legs.map((i) => legNodes()[i]);
      const lengths = nodes.map((n) => n.getTotalLength());
      const starts = lengths.map((_, j) =>
        lengths.slice(0, j).reduce((a, b) => a + b, 0),
      );
      const total = lengths.reduce((a, b) => a + b, 0);
      let reached = 0;
      return d3
        .select(tripLayer.node())
        .transition("trip-draw")
        .duration(ms)
        .ease(d3.easeLinear)
        .tween("draw", () => (t) => {
          const pos = t * total;
          nodes.forEach((node, j) => {
            const drawn = Math.max(0, Math.min(lengths[j], pos - starts[j]));
            node.setAttribute("stroke-dashoffset", lengths[j] - drawn);
          });
          while (
            reached < nodes.length &&
            (t === 1 || pos >= starts[reached] + lengths[reached])
          ) {
            onReach(run.legs[reached]);
            reached += 1;
          }
        })
        .end();
    },
    lightStop: (stop) => {
      const marker = g
        .selectAll(".park-marker")
        .filter((d) => d.parkCode === stop.park.parkCode)
        .classed("trip-pending", false)
        .classed("trip-arrive", true);
      marker.on("animationend.trip", () =>
        marker.classed("trip-arrive", false).on("animationend.trip", null),
      );
      tripsUI.markStop(stop.number);
      const trip = tripsUI.current();
      const day = trip?.days.find((d) => d.stops[0] === stop);
      if (day) {
        announce(
          `${formatDay(day.date)}: ${day.stops.map((s) => s.park.name).join(", ")}`,
          0,
        );
      }
    },
    finish: (trip, { fit }) => {
      showRouteComplete(trip);
      if (fit) fitTrip(trip);
    },
    onState: (playing) => tripsUI.setPlaying(playing),
  });
}

/**
 * Hide every leg (full dash offset) and mark every stop pending, ready for
 * the player to draw them in.
 * @param {object} trip - Built trip
 */
function resetRoute(trip) {
  tripLayer.interrupt("trip-draw");
  tripLayer.selectAll(".trip-leg").each(function () {
    const len = this.getTotalLength();
    d3.select(this)
      .attr("stroke-dasharray", `${len} ${len}`)
      .attr("stroke-dashoffset", len);
  });
  tripMarkers(trip).classed("trip-pending", true).classed("trip-arrive", false);
  tripsUI.markStop(null);
}

/**
 * Show the whole route drawn and every stop lit.
 * @param {object} trip - Built trip
 */
function showRouteComplete(trip) {
  tripLayer.interrupt("trip-draw");
  tripLayer
    .selectAll(".trip-leg")
    .attr("stroke-dasharray", null)
    .attr("stroke-dashoffset", null);
  tripMarkers(trip)
    .classed("trip-pending", false)
    .classed("trip-arrive", false);
  tripsUI.markStop(null);
}

/**
 * Play a trip's route from the start, or show it complete under reduced
 * motion.
 * @param {object} trip - Built trip
 */
function playTrip(trip) {
  if (reduceMotion) {
    showRouteComplete(trip);
    fitTrip(trip);
    return;
  }
  resetRoute(trip);
  tripPlayer.play(trip);
}

/**
 * Draw a trip: dim the other markers, enlarge the stops, draw one route leg
 * per pair of consecutive stops, and zoom to fit.
 * @param {object} trip - Built trip
 */
function showTripOnMap(trip) {
  clearActiveState();
  const codes = new Set(trip.stops.map((s) => s.park.parkCode));
  g.classed("trip-mode", true);
  g.selectAll(".park-marker")
    .classed("trip-stop", (d) => codes.has(d.parkCode))
    .filter((d) => codes.has(d.parkCode))
    .raise();
  sizeDots();
  syncActiveState();

  // Legs are GeoJSON, so the resize handler's `path` redraw covers them.
  const legs = d3.pairs(trip.stops).map(([a, b]) => ({
    type: "LineString",
    coordinates: [
      [+a.park.longitude, +a.park.latitude],
      [+b.park.longitude, +b.park.latitude],
    ],
  }));
  // A faint copy of the whole route sits under the line that draws in.
  const k = d3.zoomTransform(svg.node()).k;
  tripLayer
    .selectAll(".trip-leg-ghost")
    .data(legs)
    .join("path")
    .attr("class", "trip-leg-ghost")
    .attr("d", path)
    .attr("stroke-width", tripLineWidth / k);
  tripLayer
    .selectAll(".trip-leg")
    .data(legs)
    .join("path")
    .attr("class", "trip-leg")
    .attr("d", path)
    .attr("stroke-width", tripLineWidth / k);

  router?.tripChanged(trip.id);
  playTrip(trip);
  announce(`${trip.name}: ${trip.stops.length} sites`);
}

/**
 * Remove the trip drawing (tripsUI has already cleared its current trip).
 * @param {object} [options]
 * @param {boolean} [options.resetZoom=true] - Zoom back out
 */
function hideTripOnMap({ resetZoom = true } = {}) {
  tripPlayer.stop();
  svg.interrupt();
  g.classed("trip-mode", false);
  g.selectAll(".park-marker.trip-stop")
    .classed("trip-stop", false)
    .classed("trip-pending", false)
    .classed("trip-arrive", false);
  sizeDots();
  syncActiveState();
  tripLayer.selectAll("*").remove();
  router?.tripChanged(null);
  if (resetZoom) {
    svg
      .transition()
      .duration(zoomDuration)
      .call(zoom.transform, d3.zoomIdentity);
  }
}

/**
 * Date each zoom-to-complete state became complete: the latest first visit
 * among its parks. States with an unvisited park are left out.
 * @param {object[]} features - State features with `properties.parks`
 * @param {object} model - From buildTimeline
 * @return {Map<object, string>} Feature -> `YYYY-MM-DD`
 */
function completionDates(features, model) {
  const dates = new Map();
  for (const feature of features) {
    const parks = feature.properties.parks;
    if (parks.length === 0) continue;
    const firsts = parks.map((p) => model.firstVisit.get(p.parkCode));
    if (firsts.some((d) => !d)) continue;
    dates.set(feature, firsts.sort().at(-1));
  }
  return dates;
}

/**
 * Show the map as it was on `date`: parks first visited by then are green,
 * the rest brown; a state turns green on the day its last park was visited.
 * @param {string} date - `YYYY-MM-DD` (before the first visit shows none)
 * @param {object} [options]
 * @param {object} [options.event] - Timeline event being played: its parks
 *   pop and stay a little larger until the next date
 */
function applyTimelineDate(date, { event = null } = {}) {
  timelineDate = date;
  const first = timeline.firstVisit;
  const arriving = new Set(event ? event.parks.map((p) => p.parkCode) : []);
  g.selectAll(".park-marker")
    .classed(
      "tl-future",
      (d) => first.has(d.parkCode) && first.get(d.parkCode) > date,
    )
    .classed("tl-arrive", (d) => arriving.has(d.parkCode))
    .filter((d) => arriving.has(d.parkCode))
    .raise();
  sizeDots();
  g.selectAll(".state-complete").classed(
    "tl-incomplete",
    (d) => (stateCompletion.get(d) ?? "~") > date,
  );
  timelineUI.setDate(date);
}

/**
 * Enter the timeline view (the sheet is opening): leave any trip or state
 * zoom and show today's map.
 */
function showTimelineOnMap() {
  // Reopened after a park card replaced the sheet: keep the date and view.
  if (g.classed("timeline-mode")) return;
  closeTrip({ resetZoom: false });
  clearActiveState();
  searchUI?.sheet.close({ reason: "program", restoreFocus: false });
  g.classed("timeline-mode", true);
  applyTimelineDate(timeline.end);
  fitTimeline();
  router?.timelineChanged(true);
}

/**
 * Show the whole map above the timeline card: never zoomed in, shrunk just
 * enough that the card does not cover any of it.
 */
function fitTimeline() {
  const t = transformForBounds(path.bounds(stateCollection), visibleMapRect(), {
    fill: 1,
    minScale: GESTURE_MIN_SCALE,
    maxScale: 1,
  });
  svg
    .transition()
    .duration(zoomDuration)
    .call(zoom.transform, d3.zoomIdentity.translate(t.x, t.y).scale(t.k));
}

/**
 * Leave the timeline view (the sheet closed).
 * @param {object} [options]
 * @param {boolean} [options.resetZoom=true] - Zoom back out
 */
function hideTimelineOnMap({ resetZoom = true } = {}) {
  if (!g.classed("timeline-mode")) return;
  timelinePlayer.stop();
  svg.interrupt();
  g.classed("timeline-mode", false);
  g.selectAll(".tl-future, .tl-arrive")
    .classed("tl-future", false)
    .classed("tl-arrive", false);
  sizeDots();
  g.selectAll(".tl-incomplete").classed("tl-incomplete", false);
  timelineDate = null;
  router?.timelineChanged(false);
  if (resetZoom) {
    svg
      .transition()
      .duration(zoomDuration)
      .call(zoom.transform, d3.zoomIdentity);
  }
}

/**
 * Close the timeline without user intent (a trip or a state takes over).
 * @param {object} [options]
 * @param {boolean} [options.resetZoom=true] - Zoom back out
 */
function closeTimeline({ resetZoom = true } = {}) {
  if (!timelineUI) return;
  hideTimelineOnMap({ resetZoom });
  timelineUI.sheet.close({ reason: "program", restoreFocus: false });
}

/**
 * Play one timeline event: move the date (its parks turn green and pop),
 * then pause on it. The camera stays put.
 * @param {object} event - Timeline event
 * @param {() => boolean} cancelled - True once playback was paused
 */
async function timelineStep(event, cancelled) {
  applyTimelineDate(event.date, { event });
  if (cancelled()) return;
  await new Promise((resolve) => setTimeout(resolve, TIMELINE_DWELL_MS));
}

/**
 * Play from the current date (from the start when at the end), then show
 * today. Reduced motion jumps straight to today.
 */
async function playTimeline() {
  if (reduceMotion) {
    applyTimelineDate(timeline.end);
    return;
  }
  const { events, restart } = eventsAfter(
    timeline,
    timelineDate ?? timeline.end,
  );
  if (restart) {
    applyTimelineDate(isoFromDay(dayNumber(timeline.start) - 1));
  }
  const done = await timelinePlayer.play(events);
  if (!done) return;
  applyTimelineDate(timeline.end);
}

/**
 * Leave the trip view and close the trips sheet, without user intent (the
 * router moved to a state, or the map zoomed to one).
 * @param {object} [options]
 * @param {boolean} [options.resetZoom=true] - Zoom back out
 */
function closeTrip({ resetZoom = true } = {}) {
  if (!tripsUI) return;
  tripsUI.hide({ resetZoom });
  tripsUI.sheet.close({ reason: "program", restoreFocus: false });
}

/**
 * Highlight a park marker on the map by parkCode.
 * @param {string} parkCode - The park code to highlight
 * @param {object} [options]
 * @param {boolean} [options.raise=true] - Paint the marker on top
 */
function highlightParkMarker(parkCode, { raise = true } = {}) {
  const k = d3.zoomTransform(svg.node()).k;
  const marker = g
    .selectAll(".park-marker")
    .filter((d) => d.parkCode === parkCode)
    .classed("highlighted", true);
  if (raise) marker.raise();
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
    // A trip stop keeps its enlarged size (see sizeDots).
    .attr("r", (_d, i, nodes) => (pointRadius * dotScale(nodes[i])) / k)
    .attr(
      "stroke-width",
      (_d, i, nodes) => (dotScale(nodes[i]) > 1 ? 2 : dotStrokeWidth) / k,
    );
}

/**
 * Update map upon click.
 * @param {object} _ - The event callback.
 * @param {object} d - The object clicked.
 * @return {undefined}
 */
function clickedMap(_, d) {
  // The mobile park card is non-modal, so this tap reached the map: one tap
  // both closes the card and zooms.
  closeParkSheet();
  if (active.node() === this) return resetMap();
  closeTrip({ resetZoom: false });
  closeTimeline({ resetZoom: false });
  active.classed("active", false);
  active = d3.select(this).classed("active", true);
  // Dim every other state instead of recoloring the active one.
  g.selectAll(".state, .state-complete").classed(
    "dimmed",
    (_d, i, nodes) => nodes[i] !== this,
  );
  syncActiveState();
  router?.stateChanged(stateAbbreviations[d.properties.name]);

  // Clamp to the zoom behavior's scale extent and drive the zoom through it so
  // its stored transform stays in sync. Otherwise a subsequent drag/pan starts
  // from the stale (identity) transform and snaps the map back to full country.
  const t = transformForBounds(
    path.bounds(d),
    { x: 0, y: 0, width, height },
    { fill: 0.9, minScale: MIN_SCALE, maxScale: MAX_SCALE },
  );
  const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);

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
  clearActiveState();
  tripsUI?.hide({ resetZoom: false });
  closeTimeline({ resetZoom: false });
  router?.stateChanged(null);

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
}

/**
 * Leave the zoomed state: close the park sheet and the state park list, and
 * clear the active state. The zoom itself is the caller's business.
 */
function clearActiveState() {
  closeParkSheet();
  active.classed("active", false);
  active = d3.select(null);
  g.selectAll(".dimmed").classed("dimmed", false);
  syncActiveState();
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
  placeTooltip(
    text,
    event.clientX + TOOLTIP_OFFSET,
    event.clientY + TOOLTIP_OFFSET,
  );
}

/**
 * Show the tooltip under the focused element's bounding box. Only for
 * keyboard focus: a pointer click also focuses the element, and the hover
 * tooltip already covers that.
 * @param {FocusEvent} event - The focus event
 * @param {string} text - Tooltip text
 */
function showTooltipForFocus(event, text) {
  const el = event.currentTarget;
  if (!el.matches(":focus-visible")) return;
  // A marker's own box includes the transparent touch circle; use the dot.
  const target = el.querySelector(".park-dot") || el;
  const rect = target.getBoundingClientRect();
  placeTooltip(text, rect.left + rect.width / 2, rect.bottom + TOOLTIP_OFFSET);
}

/**
 * Position and reveal the tooltip, clamped inside the viewport.
 * @param {string} text - Tooltip text
 * @param {number} x - Preferred left edge in viewport px
 * @param {number} y - Preferred top edge in viewport px
 */
function placeTooltip(text, x, y) {
  // Reset position first so a previous near-edge position cannot wrap the text.
  tooltip
    .text(text)
    .attr("aria-hidden", "false")
    .style("left", "0px")
    .style("top", "0px");
  const rect = tooltip.node().getBoundingClientRect();
  const maxLeft = document.documentElement.clientWidth - rect.width;
  const maxTop = document.documentElement.clientHeight - rect.height;
  const left = Math.max(TOOLTIP_MARGIN, Math.min(x, maxLeft - TOOLTIP_MARGIN));
  const top = Math.max(TOOLTIP_MARGIN, Math.min(y, maxTop - TOOLTIP_MARGIN));
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

  // Before data loads there is nothing to fit or redraw.
  if (!stateCollection) {
    svg.attr("width", width).attr("height", height);
    svg.select(".background").attr("width", width).attr("height", height);
    return;
  }
  updateProjection();

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

  // Reset map view if zoomed; a trip refits to the new size instead.
  if (active.node()) {
    resetMap();
  } else if (g.classed("timeline-mode")) {
    fitTimeline();
  } else if (tripsUI?.current()) {
    // Leg lengths changed with the projection: end any playback first.
    if (tripPlayer.isPlaying()) tripPlayer.skip();
    else fitTrip(tripsUI.current());
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
 * Draw the keyboard focus ring around a state.
 * @param {object} d - State feature
 */
function showFocusRing(d) {
  if (focusRing) focusRing.datum(d).attr("d", path).attr("display", null);
}

/**
 * Hide the state keyboard focus ring.
 */
function hideFocusRing() {
  if (focusRing) focusRing.attr("display", "none");
}

/**
 * Mirror the active state into accessibility state: `aria-pressed` on the
 * state buttons, and tab stops on markers. Only the active state's markers are
 * tabbable (437 global tab stops would be unusable); in the trip view the
 * trip's stops are; otherwise none are. Plan deviation: the plan puts
 * tabindex 0 on every marker.
 */
function syncActiveState() {
  const activeNode = active.node();
  g.selectAll(".state, .state-complete").attr("aria-pressed", (_d, i, nodes) =>
    String(nodes[i] === activeNode),
  );
  const trip = tripsUI?.current();
  let codes = null;
  if (activeNode) {
    codes = new Set(active.datum().properties.parks.map((p) => p.parkCode));
  } else if (trip) {
    codes = new Set(trip.stops.map((s) => s.park.parkCode));
  }
  syncMarkerTabindex(g.selectAll(".park-marker").nodes(), codes);
}

/**
 * Enter/Space on a state. Same code path as a click. When that zooms in,
 * move focus to the "Parks in <State>" toolbar button: the state's markers
 * come before the toolbar in tab order, so leaving focus on the state would
 * force a long Tab through the other states. Shift+Tab from the button
 * reaches the active state's markers.
 * @param {KeyboardEvent} event - The keydown event
 */
function activateStateFromKey(event) {
  const node = event.currentTarget;
  const d = d3.select(node).datum();
  clickedMap.call(node, event, d);
  if (active.node() !== node) return; // toggled off; focus stays on the state
  const parks = d.properties.parks;
  announce(
    `${d.properties.name}, ${countParksVisited(parks)} of ${parks.length} sites visited`,
  );
  parksButton.node().focus();
}

// Escape on the map resets the zoom and returns focus to the state that was
// active (focus may be on one of its markers). It only acts while a state is
// active, so a plain Escape elsewhere is untouched. Non-modal sheets (search,
// the mobile park card) leave the map focusable; while one is open, Escape
// closes the sheet first (document handler above) and the zoom stays.
svg.on("keydown", (event) => {
  if (event.key !== "Escape" || hasOpenSheet()) return;
  // Timeline view with its sheet closed: Escape leaves it.
  if (g.classed("timeline-mode")) {
    event.preventDefault();
    closeTimeline();
    return;
  }
  // Trip view with its sheet closed: Escape leaves the trip.
  if (tripsUI?.current()) {
    event.preventDefault();
    tripsUI.hide();
    return;
  }
  if (!active.node()) return;
  const stateNode = active.node();
  event.preventDefault();
  resetMap();
  stateNode.focus();
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

// Offline support. `process.env.SERVICE_WORKER` is false under the webpack dev
// server, where a worker would serve stale builds.
if (process.env.SERVICE_WORKER) registerServiceWorker();
