import * as d3 from "d3";
import $ from "jquery";

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

/**
 * Show park modal when clicking on point.
 * @param {object} _ - The event callback.
 * @param {object} d - The object clicked.
 * @return {undefined}
 */
export function clickedPoint(_, d) {
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
