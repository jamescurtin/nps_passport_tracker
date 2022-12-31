import * as d3 from "d3";
import * as topojson from "topojson-client";
import $ from "jquery";
import topoJsonStates from "us-atlas/states-10m";

import parksJSON from "./data/parks";
import visitsJSON from "./data/visits";

import color from "./js/colorscale";
import { clickedPoint } from "./js/modal";
import stateAbbreviations from "./js/state_abbreviations";

import "./css/map.css";

// Modified version of geo-albers-usa that includes projections for all US territories
const geoAlbersUsaTerritories = require("geo-albers-usa-territories");

// Selector for active state when zoomed
let active = d3.select(null);

// SVG container properties
const width = d3.select("html").node().getBoundingClientRect().width;
const height = window.innerHeight;
const scale = 2 * height;
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
const projection = geoAlbersUsaTerritories
  .geoAlbersUsaTerritories()
  .scale(scale)
  .translate([width / 2, height / 2]);
const path = d3.geoPath(projection);

// Legend properties
const legendBoxSize = 18;
const legendText = ["Visited", "Not Visited"];

// Construct the body of the page
const body = d3.select("body");
const parkList = body.append("div").attr("class", "park-list");

// Require portrait mode rotation on mobile
body
  .append("div")
  .attr("id", "please-rotate")
  .append("text")
  .text("To view this site, please rotate to portrait mode.");

const tooltip = body.append("div").attr("class", "tooltip").style("opacity", 0);
const svg = body
  .append("div")
  .attr("class", "map-container")
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
const svgHeader = svg.append("g");

// Construct the legend
const legend = svg
  .append("svg")
  .attr("class", "legend")
  .attr("x", width - 100)
  .attr("y", height - 100)
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

d3.json(topoJsonStates).then(function (json) {
  d3.json(parksJSON).then(function (parkData) {
    d3.json(visitsJSON).then(function (visitData) {
      const data = mergeNPSData(parkData, visitData);
      const features = topojson.feature(json, json.objects.states).features;

      const parksVisitedCount = countParksVisited(data);
      const percentVisited = Math.round(
        (parksVisitedCount / data.length) * 100
      );

      svgHeader
        .append("text")
        .attr("class", "title")
        .attr("x", width / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text(`${mapTitle} (Visited ${percentVisited}% of NPS Units)`);

      svgHeader
        .append("text")
        .attr("x", width / 2)
        .attr("y", 40)
        .attr("text-anchor", "middle")
        .text("Click on a point for more info, or on a state to zoom");

      // Add NPS sites as properties of the states they are located within
      for (let i = 0; i < features.length; i++) {
        features[i].properties.parks = [];
        for (let j = 0; j < data.length; j++) {
          if (
            data[j].states.includes(
              stateAbbreviations[features[i].properties.name]
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
        .attr("class", "feature")
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
  const head = table.append("thead").style("background-color", color(1));
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

  $(".park-list").hide();
}

// Reload on mobile when changing orientation so the map is drawn to fill the page
$(window).bind("orientationchange", function (_) {
  location.reload(true);
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
