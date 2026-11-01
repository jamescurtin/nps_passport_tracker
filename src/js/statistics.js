import * as d3 from "d3";

import { chart } from "./icons";
import { createSheet } from "./sheet";

/**
 * Calculate statistics from park and visit data
 */
export function calculateStats(parks, visits) {
  const totalParks = parks.length;
  const visitedParks = parks.filter((p) => p.visited === 1);
  const visitedCount = visitedParks.length;

  // Visits by year
  const visitsByYear = {};
  visits.forEach((visit) => {
    visit.visitedOn.forEach((date) => {
      const year = new Date(date).getFullYear();
      if (!isNaN(year)) {
        visitsByYear[year] = (visitsByYear[year] || 0) + 1;
      }
    });
  });

  // Visits by state
  const visitsByState = {};
  visitedParks.forEach((park) => {
    park.states.forEach((state) => {
      visitsByState[state] = (visitsByState[state] || 0) + 1;
    });
  });

  // Most visited parks (multiple visits)
  const repeatVisits = visits
    .filter((v) => v.visitedOn.length > 1)
    .map((v) => ({
      parkCode: v.parkCode,
      visits: v.visitedOn.length,
      park: parks.find((p) => p.parkCode === v.parkCode),
    }))
    .filter((v) => v.park)
    .sort((a, b) => b.visits - a.visits);

  // States with complete visits
  const stateCompletion = {};
  parks.forEach((park) => {
    park.states.forEach((state) => {
      if (!stateCompletion[state]) {
        stateCompletion[state] = { total: 0, visited: 0 };
      }
      stateCompletion[state].total++;
      if (park.visited === 1) {
        stateCompletion[state].visited++;
      }
    });
  });

  const completeStates = Object.entries(stateCompletion)
    .filter(([, data]) => data.total === data.visited && data.total > 0)
    .map(([state]) => state);

  return {
    totalParks,
    visitedCount,
    percentVisited: Math.round((visitedCount / totalParks) * 100),
    visitsByYear,
    visitsByState,
    repeatVisits,
    stateCompletion,
    completeStates,
    firstVisit: findFirstVisit(visits),
    lastVisit: findLastVisit(visits),
  };
}

function findFirstVisit(visits) {
  let earliest = null;
  visits.forEach((v) => {
    v.visitedOn.forEach((date) => {
      if (!earliest || date < earliest) earliest = date;
    });
  });
  return earliest;
}

function findLastVisit(visits) {
  let latest = null;
  visits.forEach((v) => {
    v.visitedOn.forEach((date) => {
      if (!latest || date > latest) latest = date;
    });
  });
  return latest;
}

/**
 * Render the statistics dashboard into a container (the sheet body).
 * @param {object} container - d3 selection to render into
 * @param {object} stats - Result of calculateStats
 * @return {object} The container
 */
export function renderStatsDashboard(container, stats) {
  container.selectAll("*").remove();

  // Summary cards
  const summaryRow = container.append("div").attr("class", "stats-summary");

  createStatCard(
    summaryRow,
    stats.visitedCount,
    `of ${stats.totalParks}`,
    "Parks Visited",
  );
  createStatCard(summaryRow, `${stats.percentVisited}%`, "", "Complete");
  createStatCard(
    summaryRow,
    stats.completeStates.length,
    "states",
    "Fully Explored",
  );
  createStatCard(summaryRow, stats.repeatVisits.length, "parks", "Revisited");

  // Visits by year chart
  if (Object.keys(stats.visitsByYear).length > 0) {
    const chartContainer = container
      .append("section")
      .attr("class", "stats-chart");
    chartContainer.append("h3").text("Visits by Year");
    renderYearChart(chartContainer, stats.visitsByYear);
  }

  // Top states
  if (Object.keys(stats.visitsByState).length > 0) {
    const statesContainer = container
      .append("section")
      .attr("class", "stats-states");
    statesContainer.append("h3").text("Top States");
    renderStateBars(statesContainer, stats.visitsByState);
  }

  // Complete states
  if (stats.completeStates.length > 0) {
    const completeContainer = container
      .append("section")
      .attr("class", "stats-complete");
    completeContainer.append("h3").text("Fully Explored States");
    completeContainer
      .append("p")
      .attr("class", "complete-states-list")
      .text(stats.completeStates.join(", "));
  }

  return container;
}

function createStatCard(container, value, subvalue, label) {
  const card = container.append("div").attr("class", "stat-card");
  card.append("div").attr("class", "stat-value").text(value);
  if (subvalue) {
    card.append("div").attr("class", "stat-subvalue").text(subvalue);
  }
  card.append("div").attr("class", "stat-label").text(label);
}

// Year chart geometry (px). Width comes from the container.
const CHART_HEIGHT = 180;
const CHART_MARGIN = { top: 20, right: 8, bottom: 28, left: 32 };
// Below this band width, only every Nth year gets an axis label.
const MIN_LABEL_BAND = 32;

/**
 * Bar chart of visits per year, sized to its container. A ResizeObserver
 * redraws it on width changes (and on first show: the sheet is closed, and
 * so 0px wide, when the dashboard is first rendered).
 * Colors come from CSS: bars use `var(--visited)`, axes inherit `color`.
 * @param {object} container - d3 selection that holds the chart
 * @param {object} visitsByYear - { year: count }
 */
function renderYearChart(container, visitsByYear) {
  const years = Object.keys(visitsByYear).sort();
  const data = years.map((year) => ({ year, count: visitsByYear[year] }));
  const wrap = container.append("div").attr("class", "year-chart-wrap");

  const draw = (containerWidth) => {
    wrap.selectAll("*").remove();
    if (!containerWidth) return;
    const width = containerWidth - CHART_MARGIN.left - CHART_MARGIN.right;
    const height = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;

    const svg = wrap
      .append("svg")
      .attr("class", "year-chart")
      .attr("width", containerWidth)
      .attr("height", CHART_HEIGHT)
      .attr("viewBox", `0 0 ${containerWidth} ${CHART_HEIGHT}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        `Visits by year: ${data.map((d) => `${d.year}: ${d.count}`).join(", ")}`,
      )
      .append("g")
      .attr("transform", `translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.year))
      .range([0, width])
      .padding(0.2);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count)])
      .nice()
      .range([height, 0]);

    svg
      .selectAll(".bar")
      .data(data)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.year))
      .attr("y", (d) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d) => height - y(d.count));

    // Value labels above bars, skipped when the bars are too thin to read.
    if (x.bandwidth() >= 14) {
      svg
        .selectAll(".bar-label")
        .data(data)
        .join("text")
        .attr("class", "bar-label")
        .attr("x", (d) => x(d.year) + x.bandwidth() / 2)
        .attr("y", (d) => y(d.count) - 4)
        .attr("text-anchor", "middle")
        .text((d) => d.count);
    }

    const step = Math.max(1, Math.ceil(MIN_LABEL_BAND / x.step()));
    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(x.domain().filter((_d, i) => i % step === 0))
          .tickSizeOuter(0),
      );

    svg
      .append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("d")));
  };

  if (typeof ResizeObserver === "undefined") {
    draw(wrap.node().clientWidth || 350);
    return;
  }
  // Draw in the next frame, not inside the observer callback: redrawing
  // inside it triggers "ResizeObserver loop completed with undelivered
  // notifications". The wrap also has a fixed CSS height, so a redraw never
  // changes the observed size.
  let lastWidth = -1;
  let frame = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.floor(entry.contentRect.width);
    if (w === lastWidth) return;
    lastWidth = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => draw(w));
  }).observe(wrap.node());
}

/**
 * Top 10 states as horizontal bars: state code, bar, count.
 * @param {object} container - d3 selection
 * @param {object} visitsByState - { stateCode: count }
 */
function renderStateBars(container, visitsByState) {
  const sorted = Object.entries(visitsByState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const max = sorted.length ? sorted[0][1] : 1;

  const rows = container
    .append("ol")
    .attr("class", "state-bars")
    .selectAll("li")
    .data(sorted)
    .join("li")
    .attr("aria-label", ([state, count]) => `${state}: ${count} parks`);

  rows
    .append("span")
    .attr("class", "state-bar-code")
    .attr("aria-hidden", "true")
    .text(([state]) => state);
  rows
    .append("span")
    .attr("class", "state-bar-track")
    .attr("aria-hidden", "true")
    .append("span")
    .attr("class", "state-bar-fill")
    .style("width", ([, count]) => `${(count / max) * 100}%`);
  rows
    .append("span")
    .attr("class", "state-bar-count")
    .attr("aria-hidden", "true")
    .text(([, count]) => count);
}

/**
 * Create the stats toggle button and its modal sheet.
 * @param {object} container - d3 selection the sheet is appended to
 * @param {object} stats - Result of calculateStats
 * @param {object} [toolbar=container] - d3 selection for the button
 * @return {object} The button selection
 */
export function createStatsButton(container, stats, toolbar = container) {
  let sheet = null;
  const statsButton = toolbar
    .append("button")
    .attr("type", "button")
    .attr("class", "toolbar-btn stats-toggle")
    .html(`${chart}<span class="btn-label">Stats</span>`)
    .on("click", () => {
      if (!sheet) {
        sheet = createSheet({
          id: "stats-dashboard",
          title: "Visit Statistics",
          className: "stats-sheet",
          parent: container.node(),
        });
        renderStatsDashboard(d3.select(sheet.body), stats);
      }
      if (sheet.isOpen()) sheet.close();
      else sheet.open({ opener: statsButton.node() });
    });

  return statsButton;
}
