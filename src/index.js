import * as d3 from "d3";
import * as topojson from "topojson-client";
import $ from "jquery";
import topoJsonStates from "us-atlas/states-10m";

import parksJSON from "./data/parks";
import visitsJSON from "./data/visits";

import color from "./js/colorscale";
import { clickedPoint } from "./js/modal";
import stateAbbreviations from "./js/state_abbreviations";
import { ParkSearch, createSearchUI } from "./js/search";
import { calculateStats, createStatsButton } from "./js/statistics";

import "./css/map.css";

// Modified version of geo-albers-usa that includes projections for all US territories
const geoAlbersUsaTerritories = require("geo-albers-usa-territories");

// Selector for active state when zoomed
let active = d3.select(null);

// SVG container properties - now responsive
let width = window.innerWidth;
let height = window.innerHeight;
// Use smaller scale on mobile to prevent map from being cut off
const getMapScale = () => {
  const isMobileDevice = window.innerWidth <= 768;
  const baseScale = isMobileDevice ? 1.2 : 1.5;
  return Math.min(width, height) * baseScale;
};
let scale = getMapScale();
const borderRadius = 5;

// NPS Site point marker properties
const pointRadius = 3;
const pointRadiusScaled = 4;

// On click properties
const tooltipOpacity = 0.9;
const zoomDuration = 750;
const mouseoverDuration = 200;

// Map properties
const strokeWidth = 0.25;
const mapTitle = "James & Elize's National Park Trips";
let projection = geoAlbersUsaTerritories
  .geoAlbersUsaTerritories()
  .scale(scale)
  .translate([width / 2, height / 2]);
let path = d3.geoPath(projection);

// Legend properties
const legendBoxSize = 18;
const legendText = ["Visited", "Not Visited"];

// Construct the body of the page
const body = d3.select("body");

const tooltip = body.append("div").attr("class", "tooltip").style("opacity", 0);
const svg = body
  .append("div")
  .attr("class", "map-container")
  .attr("id", "map-container")
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
  .scaleExtent([1, 16])
  .on("zoom", (event) => {
    g.attr("transform", event.transform);

    // Adjust stroke widths and point sizes based on zoom level
    const k = event.transform.k;
    g.selectAll(".mesh").attr("stroke-width", strokeWidth / k);
    g.selectAll("circle").attr("r", pointRadius / k);
  });

// Apply zoom to SVG (but filter out click events to allow state clicking)
svg.call(zoom).on("dblclick.zoom", null);
const svgHeader = svg.append("g");

const sidebarControl = svg.append("g").attr("visibility", "hidden");
const sidebar = body
  .append("div")
  .attr("class", "sidebar")
  .attr("id", "park-list-sidebar");
const closeSidebarButton = sidebar
  .append("a")
  .attr("class", "close-sidebar-button")
  .attr("href", "#")
  .on("click", prepareSidebar);
closeSidebarButton.append("text").text("✕");
const parkList = sidebar.append("div").attr("class", "park-list");

// Construct the legend (positioned at top-right to avoid stats button overlap)
const legend = svg
  .append("svg")
  .attr("class", "legend")
  .attr("x", width - 110)
  .attr("y", 60)
  .selectAll("g")
  .data(color.domain().slice().reverse())
  .enter()
  .append("g")
  .attr("transform", function (_, i) {
    return "translate(0," + i * (legendBoxSize + 2) + ")";
  });

legend
  .append("rect")
  .attr("width", legendBoxSize)
  .attr("height", legendBoxSize)
  .style("fill", color);
legend
  .append("text")
  .data(legendText)
  .attr("x", 24)
  .attr("y", 9)
  .attr("dy", ".35em")
  .text(function (d) {
    return d;
  });

const sidebarX = 20;
const sidebarY = 20;
const sidebarWidth = 125;
const sidebarHeight = 50;
const sidebarRadius = 10;
sidebarControl
  .append("rect")
  .attr("class", "openbtn")
  .attr("x", sidebarX)
  .attr("y", sidebarY)
  .attr("rx", sidebarRadius)
  .attr("ry", sidebarRadius)
  .attr("width", sidebarWidth)
  .attr("height", sidebarHeight)
  .style("fill", "#3d2314")
  .on("click", openSidebar);

sidebarControl
  .append("text")
  .text("☰ Parks in State")
  .attr("class", "openbtn")
  .attr("x", sidebarX + sidebarWidth / 2)
  .attr("y", sidebarY + sidebarHeight / 2)
  .attr("text-anchor", "middle")
  .attr("dominant-baseline", "central")
  .attr("fill", "white")
  .on("click", openSidebar);

d3.json(topoJsonStates).then(function (json) {
  d3.json(parksJSON).then(function (parkData) {
    d3.json(visitsJSON).then(function (visitData) {
      const data = mergeNPSData(parkData, visitData);
      const features = topojson.feature(json, json.objects.states).features;

      const parksVisitedCount = countParksVisited(data);
      const percentVisited = Math.round(
        (parksVisitedCount / data.length) * 100,
      );

      // Use shorter title on mobile
      const isMobileView = window.innerWidth <= 768;
      const titleText = isMobileView
        ? `${parksVisitedCount} NPS Units Visited (${percentVisited}%)`
        : `${mapTitle}: Visited ${parksVisitedCount} NPS Units (${percentVisited}%)`;
      const subtitleText = isMobileView
        ? "Tap a state to zoom"
        : "Click on a point for more info, or on a state to zoom";

      svgHeader
        .append("text")
        .attr("class", "title")
        .attr("x", width / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text(titleText);

      svgHeader
        .append("text")
        .attr("class", "subtitle")
        .attr("x", width / 2)
        .attr("y", 40)
        .attr("text-anchor", "middle")
        .text(subtitleText);

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
          return visit_count === parks_in_state ? "state-complete" : "state";
        })
        .on("mouseover", function (event, d) {
          tooltip
            .transition()
            .duration(mouseoverDuration)
            .style("opacity", tooltipOpacity);
          tooltip
            .text(d.properties.name)
            .style("left", event.pageX + "px")
            .style("top", event.pageY + "px");
        })
        .on("mouseout", function () {
          tooltip.transition().duration(mouseoverDuration).style("opacity", 0);
        })
        .on("click", clickedMap);

      g.append("path")
        .datum(mesh)
        .attr("class", "mesh")
        .attr("stroke-width", strokeWidth)
        .attr("d", path);

      g.selectAll(".mark")
        .data(data)
        .enter()
        .append("circle")
        .attr("cx", function (d) {
          return projection([d.longitude, d.latitude])[0];
        })
        .attr("cy", function (d) {
          return projection([d.longitude, d.latitude])[1];
        })
        .attr("r", pointRadius)
        .style("fill", function (d) {
          return color(d.visited);
        })
        .on("mouseover", function (event, d) {
          tooltip
            .transition()
            .duration(mouseoverDuration)
            .style("opacity", tooltipOpacity);
          tooltip
            .text(d.name)
            .style("left", event.pageX + "px")
            .style("top", event.pageY + "px");
        })
        .on("mouseout", function () {
          tooltip.transition().duration(mouseoverDuration).style("opacity", 0);
        })
        .on("click", clickedPoint);

      // Function to zoom to a state by abbreviation
      const zoomToStateByAbbrev = (stateAbbrev) => {
        // Find the state feature by abbreviation
        const stateFeature = features.find(
          (f) => stateAbbreviations[f.properties.name] === stateAbbrev,
        );
        if (stateFeature) {
          // Find the corresponding DOM element
          const stateElements = g.selectAll("path:not(.mesh)").nodes();
          const stateIndex = features.indexOf(stateFeature);
          if (stateIndex >= 0 && stateElements[stateIndex]) {
            // Simulate a click on the state
            const stateElement = stateElements[stateIndex];
            clickedMap.call(stateElement, null, stateFeature);
          }
        }
      };

      // Initialize search functionality
      const parkSearch = new ParkSearch(
        data,
        (filteredParks) => {
          // Update map to highlight/dim parks based on filter
          g.selectAll("circle")
            .style("opacity", (d) => (filteredParks.includes(d) ? 1 : 0.2))
            .style("pointer-events", (d) =>
              filteredParks.includes(d) ? "auto" : "none",
            );
        },
        zoomToStateByAbbrev,
      );

      // Create search UI
      createSearchUI(body, parkSearch);

      // Calculate and create stats button
      const stats = calculateStats(data, visitData);
      createStatsButton(body, stats);
    });
  });
});

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

  const bounds = path.bounds(d);
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;
  const scale = 0.9 / Math.max(dx / width, dy / height);
  const translate = [width / 2 - scale * x, height / 2 - scale * y];

  g.transition()
    .duration(zoomDuration)
    .style("stroke-width", strokeWidth / scale + "px")
    .attr("transform", "translate(" + translate + ")scale(" + scale + ")");

  g.selectAll(".mark")
    .transition()
    .duration(zoomDuration)
    .attr("transform", function () {
      const t = d3.geoTransform(d3.select(this).attr("transform")).translate;
      return "translate(" + t[0] + "," + t[1] + ")scale(" + 1 / scale + ")";
    });

  g.selectAll(".mesh")
    .transition()
    .duration(zoomDuration)
    .attr("stroke-width", strokeWidth / scale);

  g.selectAll("circle")
    .transition()
    .duration(zoomDuration)
    .attr("r", pointRadiusScaled / scale);

  svgHeader
    .selectAll("*")
    .transition()
    .duration(zoomDuration)
    .attr("visibility", "hidden");

  // Close search panel when zooming (but keep toggle visible)
  const searchContainer = document.getElementById("search-container");
  if (searchContainer) {
    searchContainer.style.display = "none";
  }

  prepareSidebar();

  $(".park-list").show();
  parkList.selectAll("*").remove();
  const parksVisited = countParksVisited(d.properties.parks);
  const title = `${d.properties.name} (Visited ${parksVisited} of ${d.properties.parks.length} sites)`;
  parkList.append("div").append("h2").style("text-align", "center").text(title);

  const table = parkList
    .append("div")
    .attr("class", "park-list-table")
    .append("table");
  const columns = ["Name", "Visited On"];
  const head = table.append("thead").style("background-color", color(2));
  head
    .append("tr")
    .selectAll("th")
    .data(columns)
    .enter()
    .append("th")
    .text(function (column) {
      return column;
    });
  const body = table.append("tbody");
  const rows = body
    .selectAll("tr")
    .data(d.properties.parks)
    .enter()
    .append("tr");

  rows
    .append("td")
    .append("a")
    .attr("href", "#/")
    .text(function (d) {
      return d.fullName;
    })
    .on("click", clickedPoint);

  rows.append("td").html(function (d) {
    if (d.visited) {
      return d.visitedOn.join(", ");
    } else {
      return "";
    }
  });
}

/**
 * Reset map when clicking off main projection.
 * @return {undefined}
 */
function resetMap() {
  active.classed("active", false);
  active = d3.select(null);

  // Reset d3 zoom transform
  svg.transition().duration(zoomDuration).call(zoom.transform, d3.zoomIdentity);

  g.transition()
    .duration(zoomDuration)
    .style("stroke-width", strokeWidth)
    .attr("transform", "");

  g.selectAll(".mark").attr("transform", function () {
    const t = d3.geoTransform(d3.select(this).attr("transform")).translate;
    return "translate(" + t[0] + "," + t[1] + ")scale(" + 1 + ")";
  });

  g.selectAll(".mesh")
    .transition()
    .duration(zoomDuration)
    .attr("stroke-width", strokeWidth);

  g.selectAll("circle")
    .transition()
    .duration(zoomDuration)
    .attr("r", pointRadius);

  svgHeader
    .selectAll("*")
    .transition()
    .duration(zoomDuration)
    .attr("visibility", "visible");

  sidebarControl
    .selectAll("*")
    .transition()
    .duration(zoomDuration)
    .attr("visibility", "hidden");
  hideSidebar();
  $(".park-list").hide();
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

// Detect if on mobile
function isMobile() {
  return window.innerWidth <= 768;
}

// Handle window resize for responsive map
const handleResize = debounce(() => {
  width = window.innerWidth;
  height = window.innerHeight;
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
  g.selectAll("path:not(.mesh)").attr("d", path);
  g.selectAll(".mesh").attr("d", path);

  // Reposition circles
  g.selectAll("circle")
    .attr("cx", (d) => projection([d.longitude, d.latitude])[0])
    .attr("cy", (d) => projection([d.longitude, d.latitude])[1]);

  // Reposition legend (top-right)
  svg
    .select(".legend")
    .attr("x", width - 110)
    .attr("y", 60);

  // Reposition title
  svgHeader.selectAll("text").attr("x", width / 2);

  // Reset map view if zoomed
  if (active.node()) {
    resetMap();
  }
}, 150);

window.addEventListener("resize", handleResize);

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
  return parks.map((i) => i.visited).reduce((a, b) => a + b);
}

/**
 * Prepare sidebar by hiding sidebar content and showing controls.
 */
function prepareSidebar() {
  hideSidebar();
  sidebarControl
    .selectAll("*")
    .transition()
    .duration(zoomDuration)
    .attr("visibility", "visible");
}

/**
 * Open the park list sidebar and move all content to accommodate.
 * On mobile, uses CSS classes for bottom sheet behavior.
 * On desktop, uses CSS classes for left sidebar.
 */
function openSidebar() {
  const sidebar = document.getElementById("park-list-sidebar");
  const mapContainer = document.getElementById("map-container");

  sidebar.classList.add("open");

  if (!isMobile()) {
    mapContainer.classList.add("sidebar-open");
  }

  sidebarControl
    .selectAll("*")
    .transition()
    .duration(zoomDuration)
    .attr("visibility", "hidden");
}

/**
 * Close the park list sidebar and move all content back to fill the screen.
 */
function hideSidebar() {
  const sidebar = document.getElementById("park-list-sidebar");
  const mapContainer = document.getElementById("map-container");

  sidebar.classList.remove("open", "expanded");
  mapContainer.classList.remove("sidebar-open");
}
