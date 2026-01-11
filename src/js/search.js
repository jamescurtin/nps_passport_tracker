import * as d3 from "d3";

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
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
 * Geocode an address using OpenStreetMap Nominatim API
 * @param {string} address - Address to geocode
 * @returns {Promise<{lat: number, lng: number, display_name: string}|null>}
 */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NPS-Passport-Tracker" },
    });
    const data = await response.json();
    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        display_name: data[0].display_name,
      };
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
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

/**
 * Create search UI as a modal (hidden by default, toggled via button)
 */
export function createSearchUI(container, parkSearch) {
  // Create toggle button (positioned next to Stats button)
  const searchToggle = container
    .append("button")
    .attr("class", "search-toggle")
    .attr("id", "search-toggle")
    .attr("aria-label", "Search and filter parks")
    .text("Search")
    .on("click", () => {
      const panel = document.getElementById("search-container");
      if (panel) {
        const isVisible = panel.style.display !== "none";
        panel.style.display = isVisible ? "none" : "flex";
      }
    });

  // Create search panel (hidden by default)
  const searchContainer = container
    .append("div")
    .attr("class", "search-container")
    .attr("id", "search-container")
    .style("display", "none");

  // Close button
  searchContainer
    .append("button")
    .attr("class", "search-close")
    .attr("aria-label", "Close search")
    .text("×")
    .on("click", () => {
      searchContainer.style("display", "none");
    });

  // Title
  searchContainer.append("h2").text("Search & Filter");

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

  // Filter buttons container
  const filterRow = searchContainer.append("div").attr("class", "filter-row");

  // Visited filter buttons
  filterRow
    .append("button")
    .attr("class", "filter-btn active")
    .attr("data-filter", "all")
    .text("All")
    .on("click", function () {
      d3.selectAll(".filter-btn").classed("active", false);
      d3.select(this).classed("active", true);
      parkSearch.setVisitedFilter(null);
    });

  filterRow
    .append("button")
    .attr("class", "filter-btn")
    .attr("data-filter", "visited")
    .text("Visited")
    .on("click", function () {
      d3.selectAll(".filter-btn").classed("active", false);
      d3.select(this).classed("active", true);
      parkSearch.setVisitedFilter(true);
    });

  filterRow
    .append("button")
    .attr("class", "filter-btn")
    .attr("data-filter", "not-visited")
    .text("Not Visited")
    .on("click", function () {
      d3.selectAll(".filter-btn").classed("active", false);
      d3.select(this).classed("active", true);
      parkSearch.setVisitedFilter(false);
    });

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
    stateSelect.append("option").attr("value", state).text(state);
  });

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

  // Helper function for geocode search
  async function handleGeocodeSearch() {
    const address = document.getElementById("address-input").value.trim();
    if (!address) return;

    d3.select("#location-status").text("Searching...");

    const result = await geocodeAddress(address);
    if (result) {
      const radiusMiles = parseInt(
        document.getElementById("radius-slider").value,
      );
      parkSearch.setLocationFilter(
        result.lat,
        result.lng,
        radiusMiles,
        result.display_name,
      );
      d3.select("#radius-container").style("display", "block");
      d3.select("#location-clear").style("display", "block");
      d3.select("#parks-in-range-container").style("display", "block");
      updateLocationStatus();
      updateParksList();
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

  // Helper function to update parks list
  function updateParksList() {
    const container = d3.select("#parks-in-range-container");
    container.html("");

    const parksInRange = parkSearch.getParksInRange();
    if (parksInRange.length === 0) {
      container
        .append("p")
        .attr("class", "no-parks-message")
        .text("No parks found within this radius.");
      return;
    }

    const list = container.append("ul").attr("class", "parks-in-range-list");

    parksInRange.forEach((park) => {
      const item = list.append("li").attr("class", "park-in-range-item");
      const visitedClass = park.visited === 1 ? "visited" : "not-visited";
      item
        .append("span")
        .attr("class", `park-visited-indicator ${visitedClass}`)
        .attr("title", park.visited === 1 ? "Visited" : "Not Visited");
      item
        .append("a")
        .attr("class", "park-name")
        .attr("href", park.url)
        .attr("target", "_blank")
        .text(park.name);
      item
        .append("span")
        .attr("class", "park-distance")
        .text(`${Math.round(park.distance)} mi`);
    });
  }

  return { searchContainer, searchToggle, updateParksList };
}
