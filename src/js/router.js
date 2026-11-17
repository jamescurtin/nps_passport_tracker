// Hash routes: `#/park/<parkCode>`, `#/trip/<id>` and `#/state/<ABBR>`. An
// empty hash means the default (fully zoomed out) view.
//
// This module holds no DOM or D3 code. `createRouter` takes the UI callbacks
// and the `window`-like object (`location`, `history`, event listeners) as
// options, so tests drive it with mocks.

const PARK_PREFIX = "#/park/";
const STATE_PREFIX = "#/state/";
const TRIP_PREFIX = "#/trip/";

/**
 * Parse a location hash.
 * @param {string} hash - `location.hash`, with or without the leading `#`
 * @return {{type: "reset"}|{type: "park", code: string}|
 *   {type: "state", abbr: string}|{type: "trip", id: string}|null} The route, or null when the hash is
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
  if (value.startsWith(TRIP_PREFIX)) {
    const id = decode(value.slice(TRIP_PREFIX.length));
    return id ? { type: "trip", id: id.toLowerCase() } : null;
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
 * @param {{park?: string|null, trip?: string|null, state?: string|null}}
 *   route - A park wins over a trip, a trip over a state; none gives ""
 * @return {string} `#/park/<code>`, `#/trip/<id>`, `#/state/<ABBR>` or ""
 */
export function formatHash({ park = null, trip = null, state = null } = {}) {
  if (park) return `${PARK_PREFIX}${encodeURIComponent(park)}`;
  if (trip) return `${TRIP_PREFIX}${encodeURIComponent(trip)}`;
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
 * @param {(id: string) => boolean} [options.hasTrip] - Known trip?
 * @param {(id: string) => void} [options.openTrip] - Show a trip
 * @param {() => void} [options.closeTrip] - Hide the shown trip
 * @return {object} `{ start, apply, stateChanged, parkChanged, tripChanged }`
 */
export function createRouter({
  win = window,
  parkStates,
  hasState,
  openPark,
  closePark,
  zoomState,
  reset,
  hasTrip = () => false,
  openTrip = () => {},
  closeTrip = () => {},
}) {
  // What the UI shows, kept up to date by `stateChanged` / `parkChanged` /
  // `tripChanged` (from the UI) and by `apply` (from the hash). A trip and a
  // zoomed state never coexist; a park sheet can open over either.
  const model = { state: null, park: null, trip: null };
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
        if (model.state || model.park || model.trip) reset();
        model.state = null;
        model.park = null;
        model.trip = null;
      } else if (route.type === "state") {
        if (!hasState(route.abbr)) return;
        if (model.park) closePark();
        model.park = null;
        if (model.trip) closeTrip();
        model.trip = null;
        if (model.state !== route.abbr) zoomState(route.abbr);
        model.state = route.abbr;
      } else if (route.type === "trip") {
        if (!hasTrip(route.id)) return;
        if (model.park) closePark();
        model.park = null;
        if (model.trip !== route.id) openTrip(route.id);
        model.trip = route.id;
        model.state = null;
      } else {
        const states = parkStates(route.code);
        if (!states) return;
        // Over a trip, the park opens in place: the trip view stays.
        if (!model.trip && !states.includes(model.state)) {
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
    /**
     * A trip was shown, swapped or hidden. Showing one adds a history entry,
     * so Back leaves the trip; everything else replaces.
     * @param {string|null} id - Trip id, or null when hidden
     */
    tripChanged(id) {
      const opening = id !== null && model.trip === null;
      model.trip = id;
      if (id !== null) model.state = null;
      write(opening);
    },
  };
}
