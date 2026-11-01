// Shared park row list used by the search results, the location results, and
// the state park list: visited dot, name button, secondary text, and an
// optional trailing value.

/**
 * Render `parks` as rows into a d3 selection, replacing its contents.
 * @param {object} container - d3 selection to render into
 * @param {object[]} parks - Park objects (`name`, `visited`, `parkCode`)
 * @param {object} options
 * @param {Function} options.onSelect - Called with the park on name click
 * @param {Function} [options.secondaryText] - park -> secondary line text
 * @param {Function} [options.trailingText] - park -> right-aligned text
 * @param {Function} [options.name] - park -> name text (default `park.name`)
 * @param {string} [options.emptyMessage] - Shown when `parks` is empty
 * @param {Function} [options.onHighlight] - Called with parkCode on hover
 * @param {Function} [options.onUnhighlight] - Called with parkCode on leave
 * @return {object} The `<ul>` selection, or the empty-message selection
 */
export function renderParkRows(
  container,
  parks,
  {
    onSelect,
    secondaryText,
    trailingText,
    name = (park) => park.name,
    emptyMessage = "No parks.",
    onHighlight,
    onUnhighlight,
  },
) {
  container.html("");
  if (parks.length === 0) {
    return container
      .append("p")
      .attr("class", "no-parks-message")
      .text(emptyMessage);
  }

  const list = container.append("ul").attr("class", "park-rows");
  parks.forEach((park) => {
    const visited = park.visited === 1;
    const row = list.append("li").attr("class", "park-row");

    row
      .append("span")
      .attr("class", `park-row-dot ${visited ? "visited" : "not-visited"}`)
      .attr("role", "img")
      .attr("aria-label", visited ? "Visited" : "Not visited");

    const text = row.append("div").attr("class", "park-row-text");
    text
      .append("button")
      .attr("type", "button")
      .attr("class", "park-row-name")
      .text(name(park))
      .on("click", () => onSelect(park));
    const secondary = secondaryText ? secondaryText(park) : "";
    if (secondary) {
      text.append("span").attr("class", "park-row-secondary").text(secondary);
    }

    const trailing = trailingText ? trailingText(park) : "";
    if (trailing) {
      row.append("span").attr("class", "park-row-trailing").text(trailing);
    }

    if (onHighlight) {
      row.on("mouseenter", () => onHighlight(park.parkCode));
    }
    if (onUnhighlight) {
      row.on("mouseleave", () => onUnhighlight(park.parkCode));
    }
  });
  return list;
}
