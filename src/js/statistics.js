import * as d3 from "d3";

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
 * Render statistics dashboard
 */
export function renderStatsDashboard(container, stats) {
  // Remove existing dashboard if present
  const existing = document.getElementById("stats-dashboard");
  if (existing) {
    existing.remove();
    return null;
  }

  const dashboard = container
    .append("div")
    .attr("class", "stats-dashboard")
    .attr("id", "stats-dashboard");

  // Close button
  dashboard
    .append("button")
    .attr("class", "stats-close")
    .attr("aria-label", "Close statistics")
    .text("×")
    .on("click", () => dashboard.remove());

  // Title
  dashboard.append("h2").text("Visit Statistics");

  // Summary cards
  const summaryRow = dashboard.append("div").attr("class", "stats-summary");

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
    const chartContainer = dashboard.append("div").attr("class", "stats-chart");
    chartContainer.append("h3").text("Visits by Year");
    renderYearChart(chartContainer, stats.visitsByYear);
  }

  // Top states
  if (Object.keys(stats.visitsByState).length > 0) {
    const statesContainer = dashboard
      .append("div")
      .attr("class", "stats-states");
    statesContainer.append("h3").text("Top States");
    renderStatesList(statesContainer, stats.visitsByState);
  }

  // Complete states
  if (stats.completeStates.length > 0) {
    const completeContainer = dashboard
      .append("div")
      .attr("class", "stats-complete");
    completeContainer.append("h3").text("Fully Explored States");
    completeContainer
      .append("p")
      .attr("class", "complete-states-list")
      .text(stats.completeStates.join(", "));
  }

  return dashboard;
}

function createStatCard(container, value, subvalue, label) {
  const card = container.append("div").attr("class", "stat-card");
  card.append("div").attr("class", "stat-value").text(value);
  if (subvalue) {
    card.append("div").attr("class", "stat-subvalue").text(subvalue);
  }
  card.append("div").attr("class", "stat-label").text(label);
}

function renderYearChart(container, visitsByYear) {
  const years = Object.keys(visitsByYear).sort();
  const data = years.map((year) => ({ year, count: visitsByYear[year] }));

  const margin = { top: 20, right: 20, bottom: 30, left: 40 };
  const containerWidth = 350;
  const width = containerWidth - margin.left - margin.right;
  const height = 150 - margin.top - margin.bottom;

  const svg = container
    .append("svg")
    .attr(
      "viewBox",
      `0 0 ${containerWidth} ${height + margin.top + margin.bottom}`,
    )
    .attr("class", "year-chart")
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

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
    .enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", (d) => x(d.year))
    .attr("y", (d) => y(d.count))
    .attr("width", x.bandwidth())
    .attr("height", (d) => height - y(d.count))
    .attr("fill", "#2d5a27");

  // Add value labels on bars
  svg
    .selectAll(".bar-label")
    .data(data)
    .enter()
    .append("text")
    .attr("class", "bar-label")
    .attr("x", (d) => x(d.year) + x.bandwidth() / 2)
    .attr("y", (d) => y(d.count) - 5)
    .attr("text-anchor", "middle")
    .attr("font-size", "10px")
    .attr("fill", "#3d2314")
    .text((d) => d.count);

  svg
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("font-size", "10px");

  svg
    .append("g")
    .call(d3.axisLeft(y).ticks(5))
    .selectAll("text")
    .attr("font-size", "10px");
}

function renderStatesList(container, visitsByState) {
  const sorted = Object.entries(visitsByState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const list = container.append("ul").attr("class", "states-list");

  sorted.forEach(([state, count]) => {
    list
      .append("li")
      .html(
        `<span class="state-name">${state}</span><span class="state-count">${count}</span>`,
      );
  });
}

/**
 * Create stats toggle button
 */
export function createStatsButton(container, stats) {
  const statsButton = container
    .append("button")
    .attr("class", "stats-toggle")
    .attr("aria-label", "View Statistics")
    .text("Stats")
    .on("click", () => {
      renderStatsDashboard(container, stats);
    });

  return statsButton;
}
