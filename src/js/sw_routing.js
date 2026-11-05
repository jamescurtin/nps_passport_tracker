// Cache-strategy decision for the service worker. Pure: no DOM, no `self`.
//
// - "shell":  the app itself (HTML, JS bundles, icons, manifest). Served from
//             the versioned precache.
// - "data":   JSON assets (parks, visits, us-atlas). Network first, cache as
//             the offline fallback, because parks.json changes weekly.
// - "image":  NPS photos. Cache first, in a bounded cache.
// - "bypass": everything else. The worker does not touch it.

const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp|avif)$/i;

/**
 * Pick the strategy for a request URL. Callers handle non-GET requests.
 * @param {string|URL} url - Request URL
 * @param {string} [origin] - The worker's own origin (`self.location.origin`)
 * @return {"shell"|"data"|"image"|"bypass"} Strategy
 */
export function routeRequest(url, origin = "") {
  let parsed;
  try {
    parsed = new URL(url, origin || undefined);
  } catch {
    return "bypass";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "bypass";
  }
  const host = parsed.hostname;
  if (
    (host === "nps.gov" || host.endsWith(".nps.gov")) &&
    IMAGE_PATH.test(parsed.pathname)
  ) {
    return "image";
  }
  if (parsed.origin !== origin) return "bypass";
  if (parsed.pathname === "/sw.js") return "bypass";
  return parsed.pathname.endsWith(".json") ? "data" : "shell";
}
