import * as d3 from "d3";

import color from "./colorscale.js";

const legendHeight = 50;
const legendBoxSize = 18;
const legendText = ["Parks Visited", "Parks Not Visited"];

const legend = d3
  .select("body")
  .append("svg")
  .attr("class", "legend")
  .attr("height", legendHeight)
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
