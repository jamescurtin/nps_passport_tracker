import * as d3 from "d3";
import * as topojson from "topojson-client";

import topoJsonStates from "us-atlas/states-10m.json";
import parksJSON from "./data/parks.json";
import visitsJSON from "./data/visits.json";
import "./css/map.css";
import color from "./js/colorscale.js";
import $ from "jquery";

const geoAlbersUsaTerritories = require("geo-albers-usa-territories");
const width = 960;
const height = 500;
const scale = 1000;
const pointRadius = 3;
const pointRadiusScaled = 8;
const strokeWidth = 1;
const tooltipOpacity = 0.9;
const zoomDuration = 750;
const mouseoverDuration = 200;

let active = d3.select(null);

const projection = geoAlbersUsaTerritories
  .geoAlbersUsaTerritories()
  .scale(scale)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

const modal = d3
  .select("body")
  .append("div")
  .attr("class", "modal")
  .on("click", resetPoint);

const modalContent = modal
  .append("div")
  .attr("class", "modal-content")
  .on("click", function (e) {
    e.stopPropagation();
  });

const tooltip = d3
  .select("body")
  .append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

const svg = d3
  .select("body")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

svg
  .append("rect")
  .attr("class", "background")
  .attr("width", width)
  .attr("height", height)
  .on("click", resetState);

const g = svg.append("g");

d3.json(topoJsonStates).then(function (json) {
  const features = topojson.feature(json, json.objects.states).features;
  const mesh = topojson.mesh(json, json.objects.states, function (a, b) {
    return a !== b;
  });

  g.selectAll("path")
    .data(features)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("class", "feature")
    .on("click", clickedState);

  g.append("path")
    .datum(mesh)
    .attr("class", "mesh")
    .attr("stroke-width", strokeWidth)
    .attr("d", path);

  d3.json(parksJSON).then(function (parkData) {
    d3.json(visitsJSON).then(function (visitData) {
      const data = mergeNPSData(parkData, visitData);
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
function clickedState(_, d) {
  if (active.node() === this) return resetState();
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
}

/**
 * Reset map when clicking off main projection.
 * @return {undefined}
 */
function resetState() {
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
}

/**
 * Show park modal when clicking on point.
 * @param {object} _ - The event callback.
 * @param {object} d - The object clicked.
 * @return {undefined}
 */
function clickedPoint(_, d) {
  modalContent
    .append("span")
    .attr("class", "close")
    .text("✖")
    .on("click", resetPoint);

  modalContent.append("h2").text(d.fullName);

  modalContent.append("p").text(populateVisitData(d));

  modalContent
    .append("a")
    .attr("href", d.url)
    .attr("target", "_blank")
    .attr("class", "button")
    .text("NPS Park Site");

  modalContent.append("p").text(d.description);

  modalContent
    .selectAll(".images")
    .data(d.images)
    .enter()
    .append("img")
    .attr("width", "20%")
    .attr("src", function (d) {
      return d.url;
    })
    .attr("alt", function (d) {
      return d.altText;
    });

  /**
   * Reset map when clicking off main projection.
   * @param {object} d - The event callback.
   * @return {string} The in-focus park
   */
  function populateVisitData(d) {
    if (d.visited === 1) {
      return `Visited on: ${d.visitedOn.join(", ")}`;
    } else {
      return "";
    }
  }

  $(".modal").show();
}

/**
 * Reset modal when clicking off.
 * @return {undefined}
 */
function resetPoint() {
  $(".modal").hide();
  modalContent.selectAll("*").remove();
}

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
