import * as d3 from "d3";

import { renderParkRows } from "./park_row";
import { createSheet } from "./sheet";
import stateAbbreviations from "./state_abbreviations";

// Reverse lookup: two-letter abbreviation -> full state/territory name.
const stateNamesByAbbrev = Object.fromEntries(
  Object.entries(stateAbbreviations).map(([name, abbrev]) => [abbrev, name]),
);

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in miles
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocode an address using OpenStreetMap Nominatim API.
 *
 * Nominatim identifies browser clients via the Referer header (sent
 * automatically); the User-Agent request header cannot be set from `fetch`,
 * so it is not specified here.
 *
 * @param {string} address - Address to geocode
 * @returns {Promise<{status: string, location?: {lat: number, lng: number,
 *   display_name: string}}>} Discriminated result: "ok" with a location,
 *   "not_found", "rate_limited", or "error".
 */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error("Geocoding network error:", error);
    return { status: "error" };
  }

  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  if (!response.ok) {
    console.error(`Geocoding failed: HTTP ${response.status}`);
    return { status: "error" };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.error("Geocoding parse error:", error);
    return { status: "error" };
  }

  if (Array.isArray(data) && data.length > 0) {
    return {
      status: "ok",
      location: {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        display_name: data[0].display_name,
      },
    };
  }
  return { status: "not_found" };
}

/**
 * Search/filter module for parks
 */
export class ParkSearch {
  constructor(parks, onFilter, onStateSelect = null, onLocationZoom = null) {
    this.allParks = parks;
    this.onFilter = onFilter;
    this.onStateSelect = onStateSelect;
    this.onLocationZoom = onLocationZoom;
    this.filters = {
      query: "",
      visited: null, // null = all, true = visited only, false = not visited
      state: null,
      location: null, // { lat, lng, radiusMiles, displayName }
    };
  }

  setQuery(query) {
    this.filters.query = query.toLowerCase().trim();
    this.applyFilters();
  }

  setVisitedFilter(visited) {
    this.filters.visited = visited;
    this.applyFilters();
  }

  setStateFilter(state, triggerZoom = false) {
    this.filters.state = state;
    this.applyFilters();
    if (triggerZoom && state && this.onStateSelect) {
      this.onStateSelect(state);
    }
  }

  setLocationFilter(lat, lng, radiusMiles, displayName = "") {
    this.filters.location = { lat, lng, radiusMiles, displayName };
    this.applyFilters();
    if (this.onLocationZoom) {
      this.onLocationZoom(lat, lng, radiusMiles);
    }
  }

  updateRadius(radiusMiles) {
    if (this.filters.location) {
      this.filters.location.radiusMiles = radiusMiles;
      this.applyFilters();
      if (this.onLocationZoom) {
        this.onLocationZoom(
          this.filters.location.lat,
          this.filters.location.lng,
          radiusMiles,
        );
      }
    }
  }

  clearLocationFilter() {
    this.filters.location = null;
    this.applyFilters();
    if (this.onLocationZoom) {
      this.onLocationZoom(null, null, null);
    }
  }

  clearFilters() {
    this.filters = { query: "", visited: null, state: null, location: null };
    this.applyFilters();
  }

  applyFilters() {
    let filtered = this.allParks;

    // Text search
    if (this.filters.query) {
      filtered = filtered.filter(
        (park) =>
          park.name.toLowerCase().includes(this.filters.query) ||
          park.fullName.toLowerCase().includes(this.filters.query) ||
          park.states.some((s) => s.toLowerCase().includes(this.filters.query)),
      );
    }

    // Visited filter
    if (this.filters.visited !== null) {
      filtered = filtered.filter((park) =>
        this.filters.visited ? park.visited === 1 : park.visited === 0,
      );
    }

    // State filter
    if (this.filters.state) {
      filtered = filtered.filter((park) =>
        park.states.includes(this.filters.state),
      );
    }

    // Location/distance filter
    if (this.filters.location) {
      const { lat, lng, radiusMiles } = this.filters.location;
      filtered = filtered.filter((park) => {
        const distance = haversineDistance(
          lat,
          lng,
          park.latitude,
          park.longitude,
        );
        park.distanceFromSearch = distance;
        return distance <= radiusMiles;
      });
      // Sort by distance (closest first)
      filtered.sort((a, b) => a.distanceFromSearch - b.distanceFromSearch);
    }

    this.onFilter(filtered);
    if (this.onResults) {
      this.onResults(filtered);
    }
  }

  /**
   * Whether any non-location filter (text, visited, or state) is active.
   * @returns {boolean}
   */
  hasActiveListFilter() {
    return Boolean(
      this.filters.query || this.filters.visited !== null || this.filters.state,
    );
  }

  getParksInRange() {
    if (!this.filters.location) return [];
    const { lat, lng, radiusMiles } = this.filters.location;
    const parksInRange = [];
    for (const park of this.allParks) {
      const distance = haversineDistance(
        lat,
        lng,
        park.latitude,
        park.longitude,
      );
      if (distance <= radiusMiles) {
        // Also apply visited filter if set
        let includesPark = false;
        if (this.filters.visited === null) {
          includesPark = true;
        } else if (this.filters.visited && park.visited === 1) {
          includesPark = true;
        } else if (!this.filters.visited && park.visited === 0) {
          includesPark = true;
        }
        if (includesPark) {
          parksInRange.push({ ...park, distance });
        }
      }
    }
    // Sort by distance (ascending)
    parksInRange.sort((a, b) => a.distance - b.distance);
    return parksInRange;
  }

  getParksInRangeCount() {
    return this.getParksInRange().length;
  }

  getUniqueStates() {
    const states = new Set();
    this.allParks.forEach((park) => {
      park.states.forEach((s) => states.add(s));
    });
    return Array.from(states).sort();
  }
}

// Visited filter options for the segmented control: [key, label, value].
const VISITED_OPTIONS = [
  ["all", "All", null],
  ["visited", "Visited", true],
  ["not-visited", "Not Visited", false],
];

/**
 * Create the search UI: a toolbar toggle plus a non-modal sheet (a floating
 * card at the bottom-left on desktop, a bottom sheet on mobile).
 * @param {object} container - d3 selection the sheet is appended to
 * @param {ParkSearch} parkSearch - Search model
 * @param {object} [toolbar=container] - d3 selection for the toggle button
 * @return {object} `{ sheet, searchContainer, searchToggle, updateParksList }`
 */
export function createSearchUI(container, parkSearch, toolbar = container) {
  const sheet = createSheet({
    id: "search-container",
    title: "Search & Filter",
    modal: false,
    anchor: "bottom-left",
    className: "search-sheet",
    parent: container.node(),
  });

  // Create toggle button (lives in the toolbar)
  const searchToggle = toolbar
    .append("button")
    .attr("type", "button")
    .attr("class", "search-toggle")
    .attr("id", "search-toggle")
    .attr("aria-label", "Search and filter parks")
    .text("Search")
    .on("click", () => {
      if (sheet.isOpen()) sheet.close();
      else sheet.open({ opener: searchToggle.node() });
    });

  const searchContainer = d3.select(sheet.body);

  // Search input
  searchContainer
    .append("input")
    .attr("type", "search")
    .attr("placeholder", "Search parks...")
    .attr("class", "search-input")
    .attr("aria-label", "Search parks")
    .on("input", function () {
      parkSearch.setQuery(this.value);
    });

  // Visited filter: a segmented control with radio semantics and a roving
  // tabindex (arrow keys move the selection, as for native radios).
  const segmented = searchContainer
    .append("div")
    .attr("class", "segmented")
    .attr("role", "radiogroup")
    .attr("aria-label", "Visited filter");

  const segments = segmented
    .selectAll("button")
    .data(VISITED_OPTIONS)
    .join("button")
    .attr("type", "button")
    .attr("class", "segment")
    .attr("role", "radio")
    .attr("data-filter", ([key]) => key)
    .text(([, label]) => label)
    .on("click", (_event, option) => selectSegment(option))
    .on("keydown", (event, option) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
        event.key
      ];
      if (!step) return;
      event.preventDefault();
      const i = VISITED_OPTIONS.indexOf(option);
      const next =
        VISITED_OPTIONS[
          (i + step + VISITED_OPTIONS.length) % VISITED_OPTIONS.length
        ];
      selectSegment(next);
      segments
        .filter((o) => o === next)
        .node()
        .focus();
    });

  function markSegment(selected) {
    segments
      .attr("aria-checked", (o) => String(o === selected))
      .attr("tabindex", (o) => (o === selected ? 0 : -1));
  }

  function selectSegment(option) {
    markSegment(option);
    parkSearch.setVisitedFilter(option[2]);
  }

  markSegment(VISITED_OPTIONS[0]);

  // State dropdown
  const stateSelect = searchContainer
    .append("select")
    .attr("class", "state-select")
    .attr("aria-label", "Filter by state")
    .on("change", function () {
      parkSearch.setStateFilter(this.value || null, true);
    });

  stateSelect.append("option").attr("value", "").text("All States");

  parkSearch.getUniqueStates().forEach((state) => {
    stateSelect
      .append("option")
      .attr("value", state)
      .text(stateNamesByAbbrev[state] || state);
  });

  // Results section for text/state/visited filters (hidden until a filter is
  // active). The separate location section renders its own distance-sorted list.
  const resultsSection = searchContainer
    .append("div")
    .attr("class", "results-section")
    .attr("id", "results-section")
    .style("display", "none");

  resultsSection
    .append("div")
    .attr("class", "results-count")
    .attr("id", "results-count");

  resultsSection
    .append("div")
    .attr("class", "results-list-container")
    .attr("id", "results-list-container");

  // Location search section
  const locationSection = searchContainer
    .append("div")
    .attr("class", "location-section");

  // Section header (collapsible)
  const locationHeader = locationSection
    .append("button")
    .attr("class", "location-toggle")
    .attr("aria-expanded", "false")
    .on("click", function () {
      const content = document.getElementById("location-content");
      const isExpanded = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", !isExpanded);
      content.style.display = isExpanded ? "none" : "block";
      d3.select(this)
        .select(".chevron")
        .text(isExpanded ? "+" : "-");
    });

  locationHeader.append("span").attr("class", "chevron").text("+");
  locationHeader.append("span").text(" Find Parks Near Location");

  // Location content (hidden by default)
  const locationContent = locationSection
    .append("div")
    .attr("id", "location-content")
    .attr("class", "location-content")
    .style("display", "none");

  // Address input row
  const addressRow = locationContent.append("div").attr("class", "address-row");

  addressRow
    .append("input")
    .attr("type", "text")
    .attr("placeholder", "Enter address, city, or ZIP...")
    .attr("class", "address-input")
    .attr("id", "address-input")
    .attr("aria-label", "Enter location")
    .on("keypress", function (event) {
      if (event.key === "Enter") {
        handleGeocodeSearch();
      }
    });

  addressRow
    .append("button")
    .attr("class", "address-search-btn")
    .attr("aria-label", "Search location")
    .text("Go")
    .on("click", handleGeocodeSearch);

  // "Use my location" geolocation button
  locationContent
    .append("button")
    .attr("type", "button")
    .attr("class", "geolocate-btn")
    .text("📍 Use my location")
    .on("click", handleGeolocate);

  // Status display
  locationContent
    .append("div")
    .attr("class", "location-status")
    .attr("id", "location-status");

  // Radius slider container (hidden until location is set)
  const radiusContainer = locationContent
    .append("div")
    .attr("class", "radius-container")
    .attr("id", "radius-container")
    .style("display", "none");

  radiusContainer.append("label").attr("for", "radius-slider").text("Radius:");

  const radiusRow = radiusContainer.append("div").attr("class", "radius-row");

  radiusRow
    .append("input")
    .attr("type", "range")
    .attr("id", "radius-slider")
    .attr("class", "radius-slider")
    .attr("min", "10")
    .attr("max", "500")
    .attr("value", "100")
    .attr("aria-label", "Search radius in miles")
    .on("input", function () {
      const value = parseInt(this.value);
      d3.select("#radius-value").text(`${value} miles`);
      parkSearch.updateRadius(value);
      updateLocationStatus();
      updateParksList();
    });

  radiusRow
    .append("span")
    .attr("id", "radius-value")
    .attr("class", "radius-value")
    .text("100 miles");

  // Parks in range list container (hidden until location is set)
  locationContent
    .append("div")
    .attr("class", "parks-in-range-container")
    .attr("id", "parks-in-range-container")
    .style("display", "none");

  // Clear button
  locationContent
    .append("button")
    .attr("class", "location-clear")
    .attr("id", "location-clear")
    .style("display", "none")
    .text("Clear Location")
    .on("click", () => {
      parkSearch.clearLocationFilter();
      d3.select("#address-input").property("value", "");
      d3.select("#location-status").text("");
      d3.select("#radius-container").style("display", "none");
      d3.select("#location-clear").style("display", "none");
      d3.select("#parks-in-range-container").style("display", "none");
    });

  // Apply a resolved location (from geocoding or geolocation) as the active
  // distance filter and reveal the radius/list controls.
  function applyLocation(lat, lng, displayName) {
    const radiusMiles = parseInt(
      document.getElementById("radius-slider").value,
    );
    parkSearch.setLocationFilter(lat, lng, radiusMiles, displayName);
    d3.select("#radius-container").style("display", "block");
    d3.select("#location-clear").style("display", "block");
    d3.select("#parks-in-range-container").style("display", "block");
    updateLocationStatus();
    updateParksList();
  }

  // Use the browser Geolocation API to filter by the user's current position.
  function handleGeolocate() {
    if (!navigator.geolocation) {
      d3.select("#location-status").text(
        "Geolocation is not supported by your browser.",
      );
      return;
    }
    d3.select("#location-status").text("Locating...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyLocation(
          position.coords.latitude,
          position.coords.longitude,
          "Your location",
        );
      },
      (error) => {
        d3.select("#location-status").text(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied."
            : "Could not determine your location.",
        );
      },
    );
  }

  // Guard against overlapping in-flight geocode requests, which would both
  // exceed Nominatim's rate limit and risk out-of-order (last-write) results.
  let isGeocoding = false;

  // Helper function for geocode search
  async function handleGeocodeSearch() {
    if (isGeocoding) return;
    const address = document.getElementById("address-input").value.trim();
    if (!address) return;

    isGeocoding = true;
    const goButton = searchContainer.select(".address-search-btn");
    goButton.property("disabled", true);
    d3.select("#location-status").text("Searching...");

    let result;
    try {
      result = await geocodeAddress(address);
    } finally {
      isGeocoding = false;
      goButton.property("disabled", false);
    }

    if (result.status === "ok") {
      applyLocation(
        result.location.lat,
        result.location.lng,
        result.location.display_name,
      );
    } else if (result.status === "rate_limited") {
      d3.select("#location-status").text(
        "Too many searches. Please wait a moment and try again.",
      );
    } else if (result.status === "error") {
      d3.select("#location-status").text(
        "Search failed. Check your connection and try again.",
      );
    } else {
      d3.select("#location-status").text(
        "Location not found. Try a different address.",
      );
    }
  }

  // Helper function to update status display
  function updateLocationStatus() {
    const location = parkSearch.filters.location;
    if (location) {
      const count = parkSearch.getParksInRangeCount();
      const shortName = location.displayName.split(",").slice(0, 2).join(",");
      d3.select("#location-status").html(
        `<strong>${shortName}</strong><br>${count} parks within ${location.radiusMiles} miles`,
      );
    }
  }

  // Row options shared by both result lists.
  const rowOptions = {
    onSelect: (park) => {
      if (parkSearch.onParkSelect) parkSearch.onParkSelect(park);
    },
    secondaryText: (park) => park.states.join(", "),
    onHighlight: (parkCode) => {
      if (parkSearch.onHighlightPark) parkSearch.onHighlightPark(parkCode);
    },
    onUnhighlight: (parkCode) => {
      if (parkSearch.onUnhighlightPark) parkSearch.onUnhighlightPark(parkCode);
    },
  };

  // Update the location (distance-sorted) parks list.
  function updateParksList() {
    renderParkRows(
      d3.select("#parks-in-range-container"),
      parkSearch.getParksInRange(),
      {
        ...rowOptions,
        emptyMessage: "No parks found within this radius.",
        trailingText: (park) => `${Math.round(park.distance)} mi`,
      },
    );
  }

  // Render the results list for text/state/visited filters.
  function renderResults(filtered) {
    const section = d3.select("#results-section");
    if (!parkSearch.hasActiveListFilter()) {
      section.style("display", "none");
      return;
    }
    section.style("display", "block");

    d3.select("#results-count").text(
      `${filtered.length} ${filtered.length === 1 ? "park" : "parks"} match`,
    );

    renderParkRows(d3.select("#results-list-container"), filtered, {
      ...rowOptions,
      emptyMessage: "No parks match these filters.",
    });
  }

  parkSearch.onResults = renderResults;

  return { sheet, searchContainer, searchToggle, updateParksList };
}
