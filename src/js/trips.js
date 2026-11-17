// Trips: curated, ordered park visits (src/data/trips.json) shown as a list
// in a sheet. Picking a trip shows its itinerary and asks the map (through
// callbacks) to draw the route. The map side lives in src/index.js.
//
// The pure helpers at the top have no DOM access, so tests import them in
// node. `createTripsUI` touches the DOM only when called.

import * as d3 from "d3";

import { back, route } from "./icons";
import { createSheet } from "./sheet";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * @param {string} iso - `YYYY-MM-DD`
 * @return {Date} Midnight UTC of that day (no local time zone shift)
 */
function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Human date range for a trip.
 * @param {string} start - First day, `YYYY-MM-DD`
 * @param {string} end - Last day, `YYYY-MM-DD`
 * @return {string} e.g. "Aug 13, 2018", "Jun 15–21, 2024",
 *   "May 30 – Jun 2, 2024", "Dec 30, 2024 – Jan 2, 2025"
 */
export function formatDateRange(start, end) {
  const a = parseDay(start);
  const b = parseDay(end);
  const [ay, am, ad] = [a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()];
  const [by, bm, bd] = [b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()];
  if (start === end) return `${MONTHS[am]} ${ad}, ${ay}`;
  if (ay === by && am === bm) return `${MONTHS[am]} ${ad}–${bd}, ${ay}`;
  if (ay === by) return `${MONTHS[am]} ${ad} – ${MONTHS[bm]} ${bd}, ${ay}`;
  return `${MONTHS[am]} ${ad}, ${ay} – ${MONTHS[bm]} ${bd}, ${by}`;
}

/**
 * @param {string} iso - `YYYY-MM-DD`
 * @return {string} e.g. "Sat, Jun 15"
 */
export function formatDay(iso) {
  const date = parseDay(iso);
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Resolve trip data against the parks. Stops whose park is unknown are
 * dropped (with a console warning), and a trip left with fewer than two
 * stops is dropped too.
 * @param {object[]} tripData - Parsed trips.json
 * @param {Map<string, object>} parksByCode - Park objects by parkCode
 * @return {object[]} Trips, newest first: `{ id, name, start, end, states,
 *   stops: [{ park, date, number }], days: [{ date, stops }] }`
 */
export function buildTrips(tripData, parksByCode) {
  const trips = [];
  for (const raw of tripData) {
    const stops = [];
    for (const stop of raw.stops) {
      const park = parksByCode.get(stop.parkCode);
      if (!park) {
        console.warn(`Trip ${raw.id}: unknown park ${stop.parkCode}`);
        continue;
      }
      stops.push({ park, date: stop.date, number: stops.length + 1 });
    }
    if (stops.length < 2) continue;
    const days = [];
    for (const stop of stops) {
      const last = days[days.length - 1];
      if (last && last.date === stop.date) last.stops.push(stop);
      else days.push({ date: stop.date, stops: [stop] });
    }
    const states = [...new Set(stops.flatMap((s) => s.park.states))];
    trips.push({
      id: raw.id,
      name: raw.name,
      start: stops[0].date,
      end: stops[stops.length - 1].date,
      states,
      stops,
      days,
    });
  }
  return trips.sort((a, b) => (a.start < b.start ? 1 : -1));
}

/**
 * @param {object} trip - Built trip
 * @return {string} e.g. "Jun 15–21, 2024 · 23 sites"
 */
export function tripSummary(trip) {
  return `${formatDateRange(trip.start, trip.end)} · ${trip.stops.length} sites`;
}

/**
 * Create the Trips toolbar button and its sheet.
 * @param {object} options
 * @param {object} options.container - d3 selection the sheet is appended to
 * @param {object} options.toolbar - d3 selection for the button
 * @param {object[]} options.trips - Built trips (see buildTrips)
 * @param {(trip: object) => void} options.onShow - Draw a trip on the map
 * @param {(options: {resetZoom: boolean}) => void} options.onHide - Remove
 *   the trip from the map
 * @param {(park: object, event: Event) => void} options.onSelectStop - A stop
 *   in the itinerary was picked
 * @param {(code: string) => void} [options.onHighlight] - Stop row hovered
 * @param {(code: string) => void} [options.onUnhighlight] - Hover left
 * @param {() => void} [options.onOpen] - The sheet is about to open
 * @return {object} `{ sheet, button, show, hide, current, hasTrip }`
 */
export function createTripsUI({
  container,
  toolbar,
  trips,
  onShow,
  onHide,
  onSelectStop,
  onHighlight = () => {},
  onUnhighlight = () => {},
  onOpen = () => {},
}) {
  const byId = new Map(trips.map((t) => [t.id, t]));
  let current = null;

  const sheet = createSheet({
    id: "trips-sheet",
    title: "Trips",
    modal: false,
    anchor: "bottom-left",
    className: "trips-sheet",
    parent: container.node(),
    // Mobile: a half-height card keeps the route visible above it.
    snapPoints: ["peek", "full"],
    // A user close (button, Escape, drag) leaves the trip. Another sheet
    // replacing this card ("program") keeps the route on the map.
    onClose: (reason) => {
      if (reason !== "program") hide();
    },
  });

  let button = toolbar.select(".trips-toggle");
  if (button.empty()) {
    button = toolbar
      .append("button")
      .attr("type", "button")
      .attr("class", "toolbar-btn trips-toggle")
      .html(`${route}<span class="btn-label">Trips</span>`);
  }
  button.on("click", () => {
    if (sheet.isOpen()) sheet.close();
    else openSheet();
  });

  /**
   * Open the sheet on the current view (trip or list).
   */
  function openSheet() {
    if (current) renderTrip(current);
    else renderList();
    onOpen();
    sheet.open({ opener: button.node() });
  }

  function renderList() {
    sheet.setTitle("Trips");
    sheet.header.replaceChildren();
    const body = d3.select(sheet.body);
    body.html("");
    const list = body.append("ul").attr("class", "trip-list");
    for (const trip of trips) {
      const item = list
        .append("li")
        .append("button")
        .attr("type", "button")
        .attr("class", "trip-row")
        .attr("data-trip-id", trip.id)
        .on("click", () => show(trip.id));
      item.append("span").attr("class", "trip-row-name").text(trip.name);
      item
        .append("span")
        .attr("class", "trip-row-meta")
        .text(tripSummary(trip));
      item
        .append("span")
        .attr("class", "trip-row-states")
        .text(trip.states.join(" · "));
    }
    sheet.body.scrollTop = 0;
  }

  /**
   * @param {object} trip - Built trip
   */
  function renderTrip(trip) {
    sheet.setTitle(trip.name);
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "trip-back";
    backButton.innerHTML = `${back}<span>All trips</span>`;
    backButton.addEventListener("click", () => {
      hide();
      const first = sheet.body.querySelector(".trip-row");
      if (first) first.focus();
    });
    sheet.header.replaceChildren(backButton);

    const body = d3.select(sheet.body);
    body.html("");
    body
      .append("p")
      .attr("class", "trip-meta")
      .text(`${tripSummary(trip)} · ${trip.states.join(", ")}`);
    const days = body.append("ol").attr("class", "trip-days");
    for (const day of trip.days) {
      const dayItem = days.append("li").attr("class", "trip-day");
      dayItem
        .append("h3")
        .attr("class", "trip-day-label")
        .text(formatDay(day.date));
      const stops = dayItem.append("ol").attr("class", "trip-stops");
      for (const stop of day.stops) {
        const row = stops
          .append("li")
          .attr("class", "trip-stop-row")
          .on("mouseenter", () => onHighlight(stop.park.parkCode))
          .on("mouseleave", () => onUnhighlight(stop.park.parkCode));
        row
          .append("span")
          .attr("class", "trip-stop-number")
          .attr("aria-hidden", "true")
          .text(stop.number);
        row
          .append("button")
          .attr("type", "button")
          .attr("class", "trip-stop-name")
          .text(stop.park.fullName)
          .on("click", (event) => onSelectStop(stop.park, event));
      }
    }
    sheet.body.scrollTop = 0;
  }

  /**
   * Show a trip: itinerary in the sheet, route on the map.
   * @param {string} id - Trip id
   * @param {object} [options]
   * @param {boolean} [options.openSheet=true] - Also open the sheet
   * @return {boolean} false for an unknown id
   */
  function show(id, { openSheet: open = true } = {}) {
    const trip = byId.get(id);
    if (!trip) return false;
    current = trip;
    renderTrip(trip);
    if (open && !sheet.isOpen()) {
      onOpen();
      sheet.open({ opener: button.node() });
    }
    onShow(trip);
    return true;
  }

  /**
   * Remove the trip from the map. The sheet stays as it is.
   * @param {object} [options]
   * @param {boolean} [options.resetZoom=true] - Zoom the map back out (false
   *   when the caller zooms somewhere else next)
   */
  function hide({ resetZoom = true } = {}) {
    if (!current) return;
    current = null;
    // Left from the map (Escape, a state tap): the open sheet goes back to
    // the list instead of showing a trip that is no longer drawn.
    if (sheet.isOpen()) renderList();
    onHide({ resetZoom });
  }

  return {
    sheet,
    button,
    show,
    hide,
    current: () => current,
    hasTrip: (id) => byId.has(id),
  };
}
