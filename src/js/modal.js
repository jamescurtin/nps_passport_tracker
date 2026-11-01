import * as d3 from "d3";

import { createSheet } from "./sheet";

// Created on first use so importing this module touches no DOM.
let sheet = null;

/**
 * @return {object} The park details sheet (created lazily)
 */
function getSheet() {
  if (!sheet) {
    sheet = createSheet({
      id: "park-sheet",
      title: "Park details",
      hideTitle: true,
      className: "park-sheet",
    });
  }
  return sheet;
}

/**
 * Show the park details sheet when clicking on a point.
 * @param {Event|null} event - The click event; its `currentTarget` is the
 *   element focus returns to on close (null from non-click callers)
 * @param {object} d - The park clicked.
 * @return {undefined}
 */
export function clickedPoint(event, d) {
  const parkSheet = getSheet();
  parkSheet.setTitle(d.fullName);
  renderPark(d3.select(parkSheet.body), d);
  parkSheet.body.scrollTop = 0;
  parkSheet.open({ opener: event?.currentTarget });
}

/**
 * Render a park into the sheet body.
 * @param {object} body - d3 selection of the sheet body
 * @param {object} d - Park datum
 */
function renderPark(body, d) {
  body.selectAll("*").remove();
  const images = d.images || [];
  const [hero, ...thumbs] = images;

  if (hero) {
    body
      .append("img")
      .attr("class", "park-hero")
      .attr("loading", "lazy")
      .attr("src", hero.url)
      .attr("alt", hero.altText || "");
  }

  if (d.designation) {
    body.append("span").attr("class", "badge").text(d.designation);
  }

  body.append("h2").attr("class", "park-name-heading").text(d.fullName);

  const chips = body
    .append("ul")
    .attr("class", "chips")
    .attr("aria-label", "Visits");
  if (d.visited === 1) {
    chips
      .selectAll("li")
      .data(d.visitedOn || [])
      .join("li")
      .attr("class", "chip chip-visited")
      .text((date) => `Visited ${date}`);
  } else {
    chips.append("li").attr("class", "chip").text("Not visited yet");
  }

  if (d.visited === 1 && d.notes) {
    body.append("p").attr("class", "park-notes").text(d.notes);
  }

  body.append("p").attr("class", "park-description").text(d.description);

  if (thumbs.length > 0) {
    body
      .append("div")
      .attr("class", "park-thumbs")
      .selectAll("img")
      .data(thumbs)
      .join("img")
      .attr("loading", "lazy")
      .attr("src", (img) => img.url)
      .attr("alt", (img) => img.altText || "");
  }

  body
    .append("a")
    .attr("class", "button park-link")
    .attr("href", d.url)
    .attr("target", "_blank")
    .attr("rel", "noopener")
    .text("NPS park site");
}
