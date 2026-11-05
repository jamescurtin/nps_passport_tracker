import * as d3 from "d3";

import { copyLink } from "./copy_link";
import { parkUrl } from "./router";
import { createSheet } from "./sheet";

// Created on first use so importing this module touches no DOM.
let sheet = null;

// Called with the park code when the sheet opens or swaps parks, and with
// null when it closes (the router mirrors this into the URL).
let parkListener = null;

/**
 * @param {(code: string|null) => void} listener - Park sheet change callback
 */
export function onParkSheetChange(listener) {
  parkListener = listener;
}

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
      // Mobile: a non-modal half-height card that keeps the map visible
      // above it; drag the handle up for full height. Desktop: modal dialog.
      snapPoints: ["peek", "full"],
      onClose: () => parkListener?.(null),
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
  renderCopyLink(parkSheet.header, d);
  parkSheet.body.scrollTop = 0;
  // Already open (another marker tapped): content swaps in place and the new
  // marker becomes the focus target on close.
  parkSheet.open({ opener: event?.currentTarget });
  parkListener?.(d.parkCode);
}

/**
 * Put the "Copy link" button in the sheet header area.
 * @param {Element} header - The sheet's header extra slot
 * @param {object} d - Park datum
 */
function renderCopyLink(header, d) {
  header.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-link";
  button.textContent = "Copy link";
  let timer = null;
  button.addEventListener("click", async () => {
    const ok = await copyLink(parkUrl(d.parkCode, location.href), header);
    if (!ok) return;
    button.textContent = "Link copied";
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = "Copy link";
    }, 2000);
  });
  header.prepend(button);
}

/**
 * Close the park sheet if it is open (a tap on the map while the mobile card
 * is open). Focus is not restored: the tap already moved it.
 */
export function closeParkSheet() {
  if (sheet) sheet.close({ reason: "program", restoreFocus: false });
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
