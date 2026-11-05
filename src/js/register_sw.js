/**
 * Register the service worker (offline support) once the page has loaded, so
 * it never competes with the first render. Does nothing without support.
 * @param {Navigator} [nav] - `navigator`-like object (for tests)
 * @param {Window} [win] - `window`-like object (for tests)
 */
export function registerServiceWorker(nav = navigator, win = window) {
  if (!("serviceWorker" in nav)) return;
  win.addEventListener("load", () => {
    nav.serviceWorker.register("sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
