import * as d3 from "d3";
import $ from "jquery";

const modal = d3
  .select("body")
  .append("div")
  .attr("class", "modal")
  .attr("role", "dialog")
  .attr("aria-modal", "true")
  .attr("aria-label", "Park details")
  .on("click", resetPoint);

const modalContent = modal
  .append("div")
  .attr("class", "modal-content")
  .on("click", function (e) {
    e.stopPropagation();
  });

// Track open state and the element focused before opening so focus can be
// restored on close.
let isOpen = false;
let lastFocused = null;

/**
 * Show park modal when clicking on point.
 * @param {object} _ - The event callback.
 * @param {object} d - The object clicked.
 * @return {undefined}
 */
export function clickedPoint(_, d) {
  // Clear any prior content in case a modal is opened over an existing one.
  modalContent.selectAll("*").remove();

  modalContent
    .append("button")
    .attr("type", "button")
    .attr("class", "close")
    .attr("aria-label", "Close")
    .text("✖")
    .on("click", resetPoint);

  modalContent.append("h2").text(d.fullName);

  if (d.visited === 1) {
    modalContent.append("p").text(populateVisitData(d));
    if (d.notes) {
      modalContent.append("p").attr("class", "modal-notes").text(d.notes);
    }
  }

  modalContent
    .append("a")
    .attr("href", d.url)
    .attr("target", "_blank")
    .attr("class", "button")
    .text("NPS Park Site");

  modalContent.append("p").text(d.description);

  // Image gallery with lazy loading
  const imageContainer = modalContent
    .append("div")
    .attr("class", "modal-images");

  imageContainer
    .selectAll("img")
    .data(d.images)
    .enter()
    .append("img")
    .attr("loading", "lazy")
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

  lastFocused = document.activeElement;
  $(".modal").show();
  isOpen = true;
  // Move focus into the dialog for keyboard and screen-reader users.
  const closeButton = modalContent.select(".close").node();
  if (closeButton) {
    closeButton.focus();
  }
}

/**
 * Reset modal when clicking off.
 * @return {undefined}
 */
function resetPoint() {
  $(".modal").hide();
  modalContent.selectAll("*").remove();
  isOpen = false;
  // Restore focus to whatever triggered the modal.
  if (lastFocused && typeof lastFocused.focus === "function") {
    lastFocused.focus();
    lastFocused = null;
  }
}

/**
 * Close the modal if it is open (used by the global Escape handler).
 * @return {boolean} true if the modal was open and is now closed
 */
export function closeModal() {
  if (!isOpen) return false;
  resetPoint();
  return true;
}
