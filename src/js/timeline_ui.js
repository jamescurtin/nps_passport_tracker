// Timeline sheet: running park count, a per-year bar chart of park visits
// with a playhead, a date slider under it, and Play/Pause. The map side
// (markers by date, camera) lives in src/index.js; the model in timeline.js.

import * as d3 from "d3";

import { clock, pause, play } from "./icons";
import { createSheet } from "./sheet";
import { dayNumber, isoFromDay } from "./timeline";
import { formatDateRange } from "./trips";

const CHART_HEIGHT = 64;
// Half the slider thumb width (CSS); the chart x range is inset by it so the
// thumb centre sits exactly over its date.
const THUMB_HALF = 11;
const MARGIN = { top: 14, bottom: 16 };

/**
 * Create the Timeline toolbar button and its sheet.
 * @param {object} options
 * @param {object} options.container - d3 selection the sheet is appended to
 * @param {object} options.toolbar - d3 selection for the button
 * @param {object} options.timeline - From buildTimeline
 * @param {(date: string) => void} options.onScrub - The user moved the slider
 * @param {() => void} options.onPlay - Play pressed
 * @param {() => void} options.onPause - Pause pressed
 * @param {() => void} options.onOpen - The sheet just opened
 * @param {(reason: string) => void} options.onClose - The sheet closed
 *   (reason as in createSheet)
 * @return {object} `{ sheet, button, open, setDate, setPlaying }`
 */
export function createTimelineUI({
  container,
  toolbar,
  timeline,
  onScrub,
  onPlay,
  onPause,
  onOpen,
  onClose,
}) {
  const startDay = dayNumber(timeline.start);
  const endDay = dayNumber(timeline.end);
  let date = timeline.end;
  let playing = false;
  let redraw = () => {};

  const sheet = createSheet({
    id: "timeline-sheet",
    title: "Timeline",
    // Compact: the Play row is the visible heading.
    hideTitle: true,
    modal: false,
    anchor: "bottom-left",
    className: "timeline-sheet",
    parent: container.node(),
    // Mobile: a short non-modal card; the map stays live above it.
    snapPoints: ["peek"],
    onClose: (reason) => onClose(reason),
  });

  let button = toolbar.select(".timeline-toggle");
  if (button.empty()) {
    button = toolbar
      .append("button")
      .attr("type", "button")
      .attr("class", "toolbar-btn timeline-toggle")
      .html(`${clock}<span class="btn-label">Timeline</span>`);
  }
  button.on("click", () => {
    if (sheet.isOpen()) sheet.close();
    else open();
  });

  // Header: Play/Pause, then the running count and the date.
  const header = d3.select(sheet.header);
  const row = header.append("div").attr("class", "timeline-head");
  const playButton = row
    .append("button")
    .attr("type", "button")
    .attr("class", "timeline-play")
    .on("click", () => (playing ? onPause() : onPlay()));
  const readout = row.append("p").attr("class", "timeline-readout");
  const countEl = readout.append("strong").attr("class", "timeline-count");
  readout.append("span").attr("class", "timeline-count-label");
  const dateEl = readout.append("span").attr("class", "timeline-date");

  // Body: chart with the slider laid over its lower edge.
  const wrap = d3
    .select(sheet.body)
    .append("div")
    .attr("class", "timeline-chart");
  const svg = wrap
    .append("svg")
    .attr("class", "timeline-svg")
    .attr("height", CHART_HEIGHT)
    .attr("role", "img")
    .attr(
      "aria-label",
      `Park visits per year: ${timeline.years
        .map((y) => `${y.year}: ${y.visits}`)
        .join(", ")}`,
    );
  const slider = wrap
    .append("input")
    .attr("type", "range")
    .attr("class", "timeline-slider")
    .attr("min", 0)
    .attr("max", endDay - startDay)
    .attr("step", 1)
    .attr("aria-label", "Timeline date")
    .on("input", (event) => {
      onScrub(isoFromDay(startDay + Number(event.target.value)));
    });

  /**
   * Draw the chart for a container width.
   * @param {number} width - px
   */
  function draw(width) {
    svg.attr("width", width).attr("viewBox", `0 0 ${width} ${CHART_HEIGHT}`);
    svg.selectAll("*").remove();
    const first = timeline.years[0].year;
    const last = timeline.years[timeline.years.length - 1].year;
    // Year bands span Jan 1 to Jan 1; the slider covers first visit..today.
    const x = d3
      .scaleUtc()
      .domain([Date.UTC(first, 0, 1), Date.UTC(last + 1, 0, 1)])
      .range([THUMB_HALF, width - THUMB_HALF]);
    const xDay = (iso) => x(dayNumber(iso) * 86400000);
    const baseline = CHART_HEIGHT - MARGIN.bottom;
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(timeline.years, (d) => d.visits) || 1])
      .range([baseline, MARGIN.top]);
    const band = (d) => ({
      x: x(Date.UTC(d.year, 0, 1)) + 1,
      w: Math.max(
        1,
        x(Date.UTC(d.year + 1, 0, 1)) - x(Date.UTC(d.year, 0, 1)) - 2,
      ),
    });

    const bars = svg
      .selectAll(".timeline-year")
      .data(timeline.years)
      .join("g")
      .attr("class", "timeline-year");
    bars
      .append("rect")
      .attr("class", "timeline-bar-total")
      .attr("x", (d) => band(d).x)
      .attr("width", (d) => band(d).w)
      .attr("y", (d) => y(d.visits))
      .attr("height", (d) => baseline - y(d.visits))
      .attr("rx", 2)
      .append("title")
      .text(
        (d) =>
          `${d.year}: ${d.visits} park ${d.visits === 1 ? "visit" : "visits"}`,
      );
    bars
      .append("rect")
      .attr("class", "timeline-bar")
      .attr("x", (d) => band(d).x)
      .attr("width", (d) => band(d).w)
      .attr("rx", 2);
    const wide = band(timeline.years[0]).w >= 30;
    bars
      .append("text")
      .attr("class", "timeline-year-label")
      .attr("x", (d) => band(d).x + band(d).w / 2)
      .attr("y", CHART_HEIGHT - 4)
      .attr("text-anchor", "middle")
      .text((d) => (wide ? d.year : `'${String(d.year).slice(2)}`));
    bars
      .filter((d) => d.visits > 0 && band(d).w >= 16)
      .append("text")
      .attr("class", "timeline-bar-value")
      .attr("x", (d) => band(d).x + band(d).w / 2)
      .attr("y", (d) => y(d.visits) - 4)
      .attr("text-anchor", "middle")
      .text((d) => d.visits);
    // Under the bars' value labels, so a label stays readable.
    const playhead = svg
      .insert("line", ".timeline-year")
      .attr("class", "timeline-playhead")
      .attr("y1", MARGIN.top - 6)
      .attr("y2", baseline);

    // The slider spans first visit .. today, aligned to the chart's x scale.
    const left = xDay(timeline.start) - THUMB_HALF;
    const right = xDay(timeline.end) + THUMB_HALF;
    slider.style("left", `${left}px`).style("width", `${right - left}px`);

    redraw = () => {
      bars
        .select(".timeline-bar")
        .attr("y", (d) => y(timeline.visitsInYearAt(d.year, date)))
        .attr(
          "height",
          (d) => baseline - y(timeline.visitsInYearAt(d.year, date)),
        );
      const px = xDay(date < timeline.start ? timeline.start : date);
      playhead.attr("x1", px).attr("x2", px);
    };
    redraw();
  }

  // Measure when the sheet has a width (it is display:none while closed).
  let lastWidth = -1;
  if (typeof ResizeObserver !== "undefined") {
    let frame = 0;
    new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (!w || w === lastWidth) return;
      lastWidth = w;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw(w));
    }).observe(wrap.node());
  }

  function syncPlayButton() {
    playButton
      .html(playing ? `${pause}<span>Pause</span>` : `${play}<span>Play</span>`)
      .attr("aria-pressed", String(playing));
  }

  /**
   * Show a date: count, chart, playhead and slider. Does not call onScrub.
   * @param {string} iso - `YYYY-MM-DD`; before the first visit shows zero
   */
  function setDate(iso) {
    date = iso;
    const count = timeline.countAt(iso);
    const shown = iso < timeline.start ? timeline.start : iso;
    countEl.text(count);
    readout
      .select(".timeline-count-label")
      .text(count === 1 ? " park visited" : " parks visited");
    dateEl.text(`by ${formatDateRange(shown, shown)}`);
    slider
      .property("value", Math.max(0, dayNumber(shown) - startDay))
      .attr(
        "aria-valuetext",
        `${formatDateRange(shown, shown)}, ${count} parks`,
      );
    redraw();
  }

  /**
   * @param {boolean} value - Playing or not
   */
  function setPlaying(value) {
    playing = value;
    syncPlayButton();
  }

  function open() {
    // Open first: onOpen frames the map beside the sheet, so it must be laid
    // out already.
    sheet.open({ opener: button.node() });
    onOpen();
    const w = Math.floor(wrap.node().clientWidth);
    if (w && w !== lastWidth) {
      lastWidth = w;
      draw(w);
    }
  }

  syncPlayButton();
  setDate(date);
  return { sheet, button, open, setDate, setPlaying };
}
