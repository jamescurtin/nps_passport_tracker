// Theme access for JS-drawn elements. Colors live in CSS custom properties
// (src/css/tokens.css) so the dark theme can override them.

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Read a theme token from the document root.
 * @param {string} name - Token name without the leading `--` (e.g. "visited")
 * @return {string} The computed value, or "" if the token is not defined
 */
export function themeColor(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim();
}

/**
 * Marker fill for a park.
 * @param {number|boolean} visited - Truthy if the park has been visited
 * @return {string} CSS color
 */
export function markerColor(visited) {
  return themeColor(visited ? "visited" : "not-visited");
}

/**
 * Call `cb` whenever the OS color scheme changes.
 * @param {Function} cb - Called with the MediaQueryListEvent
 * @return {Function} Call to stop listening
 */
export function onThemeChange(cb) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", cb);
  return () => query.removeEventListener("change", cb);
}
