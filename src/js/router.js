// Hash routes: `#/park/<parkCode>` and `#/state/<ABBR>`. An empty hash means
// the default (fully zoomed out) view.
//
// This module holds no DOM or D3 code. `createRouter` takes the UI callbacks
// and the `window`-like object (`location`, `history`, event listeners) as
// options, so tests drive it with mocks.

const PARK_PREFIX = "#/park/";
const STATE_PREFIX = "#/state/";

/**
 * Parse a location hash.
 * @param {string} hash - `location.hash`, with or without the leading `#`
 * @return {{type: "reset"}|{type: "park", code: string}|
 *   {type: "state", abbr: string}|null} The route, or null when the hash is
 *   not one of ours (callers ignore it)
 */
export function parseHash(hash) {
  const value = hash && hash.startsWith("#") ? hash : `#${hash || ""}`;
  if (value === "#" || value === "#/") return { type: "reset" };
  if (value.startsWith(PARK_PREFIX)) {
    const code = decode(value.slice(PARK_PREFIX.length));
    return code ? { type: "park", code: code.toLowerCase() } : null;
  }
  if (value.startsWith(STATE_PREFIX)) {
    const abbr = decode(value.slice(STATE_PREFIX.length));
    return abbr ? { type: "state", abbr: abbr.toUpperCase() } : null;
  }
  return null;
}

/**
 * @param {string} text - Percent-encoded path segment
 * @return {string} Decoded text, or "" if it is malformed or has a slash
 */
function decode(text) {
  try {
    const value = decodeURIComponent(text);
    return value.includes("/") ? "" : value;
  } catch {
    return "";
  }
}

/**
 * Format a route as a hash. Inverse of `parseHash`.
 * @param {{park?: string|null, state?: string|null}} route - A park wins over
 *   a state; neither gives "" (no hash)
 * @return {string} `#/park/<code>`, `#/state/<ABBR>` or ""
 */
export function formatHash({ park = null, state = null } = {}) {
  if (park) return `${PARK_PREFIX}${encodeURIComponent(park)}`;
  if (state) return `${STATE_PREFIX}${encodeURIComponent(state)}`;
  return "";
}

/**
 * Absolute URL that opens a park.
 * @param {string} code - Park code
 * @param {string} base - Current page URL (`location.href`)
 * @return {string} Shareable link
 */
export function parkUrl(code, base) {
  const url = new URL(base);
  url.hash = formatHash({ park: code });
  return url.href;
}

/**
 * Create the router. Nothing happens until `start()`.
 * @param {object} options
 * @param {Window} [options.win] - `location`, `history` and event source
 * @param {(code: string) => string[]|null} options.parkStates - State
 *   abbreviations of a park, best match first; null for an unknown park
 * @param {(abbr: string) => boolean} options.hasState - Known state?
 * @param {(code: string) => void} options.openPark - Open the park sheet
 * @param {() => void} options.closePark - Close the park sheet
 * @param {(abbr: string) => void} options.zoomState - Zoom to a state (and
 *   close the park sheet)
 * @param {() => void} options.reset - Zoom out and close everything
 * @return {object} `{ start, apply, stateChanged, parkChanged }`
 */
export function createRouter({
  win = window,
  parkStates,
  hasState,
  openPark,
  closePark,
  zoomState,
  reset,
}) {
  // What the UI shows, kept up to date by `stateChanged` / `parkChanged`
  // (from the UI) and by `apply` (from the hash).
  const model = { state: null, park: null };
  // True while a hash is being applied: UI callbacks then report back
  // through `stateChanged` / `parkChanged`, but nothing is written.
  let applying = false;

  /**
   * Write the URL for the current model.
   * @param {boolean} push - Add a history entry instead of replacing
   */
  function write(push) {
    if (applying) return;
    const hash = formatHash(model);
    if (hash === win.location.hash) return;
    const { pathname, search } = win.location;
    const url = `${pathname}${search}${hash}`;
    if (push) win.history.pushState(null, "", url);
    else win.history.replaceState(null, "", url);
  }

  /**
   * Make the UI match a route. Idempotent, and total: every route ends in a
   * defined view. Unknown routes and codes change nothing.
   * @param {string} hash - `location.hash`
   */
  function apply(hash) {
    const route = parseHash(hash);
    if (!route) return;
    applying = true;
    try {
      if (route.type === "reset") {
        if (model.state || model.park) reset();
        model.state = null;
        model.park = null;
      } else if (route.type === "state") {
        if (!hasState(route.abbr)) return;
        if (model.park) closePark();
        model.park = null;
        if (model.state !== route.abbr) zoomState(route.abbr);
        model.state = route.abbr;
      } else {
        const states = parkStates(route.code);
        if (!states) return;
        if (!states.includes(model.state)) {
          const target = states.find(hasState);
          if (target) {
            zoomState(target);
            model.state = target;
          }
        }
        if (model.park !== route.code) openPark(route.code);
        model.park = route.code;
      }
    } finally {
      applying = false;
    }
  }

  return {
    /**
     * Apply the current hash and follow later changes (back button, edits).
     */
    start() {
      const onChange = () => apply(win.location.hash);
      win.addEventListener("hashchange", onChange);
      win.addEventListener("popstate", onChange);
      onChange();
    },
    apply,
    /**
     * The UI zoomed to a state, or zoomed out.
     * @param {string|null} abbr - State abbreviation, or null for none
     */
    stateChanged(abbr) {
      model.state = abbr;
      write(false);
    },
    /**
     * The park sheet opened, swapped parks or closed. Opening adds one
     * history entry, so Back closes the sheet; everything else replaces.
     * @param {string|null} code - Park code, or null when closed
     */
    parkChanged(code) {
      const opening = code !== null && model.park === null;
      model.park = code;
      write(opening);
    },
  };
}
