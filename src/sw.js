// Service worker: offline support. Built as its own webpack entry (sw.js at
// the root of dist/); webpack.config.js fills in the two placeholders below.
// Strategies are chosen by routeRequest (src/js/sw_routing.js).

import { routeRequest } from "./js/sw_routing";

// Replaced at build time with the list of emitted files and a content hash.
const PRECACHE = "__PRECACHE_LIST__";
const VERSION = "__CACHE_VERSION__";

// Shell and data share one cache per build, so a new build starts clean.
const SHELL_CACHE = `nps-shell-${VERSION}`;
// Photos outlive builds; the cache is bounded instead.
const IMAGE_CACHE = "nps-images-v1";
const IMAGE_CACHE_MAX = 60;

self.addEventListener("install", (event) => {
  // No skipWaiting: the JS bundle names are not hashed, so a new worker takes
  // over only after the old page is gone.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(
          PRECACHE.map((file) => new Request(file, { cache: "reload" })),
        ),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL_CACHE && name !== IMAGE_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const kind = routeRequest(request.url, self.location.origin);
  if (kind === "shell") event.respondWith(shell(request));
  else if (kind === "data") event.respondWith(data(request));
  else if (kind === "image") event.respondWith(image(request));
});

/**
 * Precache first, network on a miss. Navigations get index.html.
 * @param {Request} request - Same-origin app request
 * @return {Promise<Response>} Response
 */
async function shell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = request.mode === "navigate" ? "index.html" : request;
  const cached = await cache.match(key, { ignoreSearch: true });
  return cached || fetch(request);
}

/**
 * Network first; the cache answers when the network fails.
 * @param {Request} request - JSON request
 * @return {Promise<Response>} Response
 */
async function data(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Cache first for NPS photos, least recently used entries evicted.
 * @param {Request} request - Image request
 * @return {Promise<Response>} Response
 */
async function image(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    // Re-insert so the hit becomes the newest entry (keys() is in order).
    await cache.put(request.url, cached.clone());
    return cached;
  }
  let response;
  try {
    // An <img> request is no-cors and would give an opaque response, which
    // cannot be checked and counts for much more storage quota. NPS sends
    // CORS headers, so ask for a readable response first.
    response = await fetch(request.url, {
      mode: "cors",
      credentials: "omit",
    });
  } catch {
    return fetch(request);
  }
  if (response.ok) {
    await cache.put(request.url, response.clone());
    await trim(cache);
  }
  return response;
}

/**
 * Delete the oldest entries beyond the limit.
 * @param {Cache} cache - The image cache
 */
async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .slice(0, Math.max(0, keys.length - IMAGE_CACHE_MAX))
      .map((key) => cache.delete(key)),
  );
}
