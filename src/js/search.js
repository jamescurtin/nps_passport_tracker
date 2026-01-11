import * as d3 from "d3";

/**
 * Search/filter module for parks
 */
export class ParkSearch {
  constructor(parks, onFilter, onStateSelect = null) {
    this.allParks = parks;
    this.onFilter = onFilter;
    this.onStateSelect = onStateSelect;
    this.filters = {
      query: "",
      visited: null, // null = all, true = visited only, false = not visited
      state: null,
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

  clearFilters() {
    this.filters = { query: "", visited: null, state: null };
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

    this.onFilter(filtered);
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

  return { searchContainer, searchToggle };
}
