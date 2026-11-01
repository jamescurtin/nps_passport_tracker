// Keyboard helpers for the map. DOM-only, no D3, so jsdom can test them.

/**
 * Keydown listener that runs `handler` on Enter or Space, like a native
 * button. Other keys, modified keys and auto-repeat are ignored.
 * @param {Function} handler - Called with the keydown event
 * @return {Function} keydown listener
 */
export function activateOnKey(handler) {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    // Stop Space from scrolling the page.
    event.preventDefault();
    handler(event);
  };
}

/**
 * Set which park markers are tab stops. Markers whose `data-park-code` is in
 * `parkCodes` get tabindex 0, all others -1. Pass null to reset every marker
 * to -1. Markers hidden by the search filter (`.filtered-out`) stay at -1.
 * @param {Iterable<Element>} markers - Marker elements with data-park-code
 * @param {Set<string>|null} parkCodes - Codes to make tabbable, or null
 */
export function syncMarkerTabindex(markers, parkCodes) {
  for (const marker of markers) {
    const tabbable =
      parkCodes !== null &&
      parkCodes.has(marker.dataset.parkCode) &&
      !marker.classList.contains("filtered-out");
    marker.setAttribute("tabindex", tabbable ? "0" : "-1");
  }
}

/**
 * Accessible name for a state button.
 * @param {string} name - State name
 * @param {number} visited - Visited sites in the state
 * @param {number} total - All sites in the state
 * @return {string} label
 */
export function stateLabel(name, visited, total) {
  return `${name}, ${visited} of ${total} sites visited`;
}

/**
 * Accessible name for a park marker.
 * @param {string} name - Park name
 * @param {boolean|number} visited - Whether the park is visited
 * @return {string} label
 */
export function markerLabel(name, visited) {
  return `${name}, ${visited ? "visited" : "not visited"}`;
}
