// Polite screen-reader announcements through the #live region in index.html.

let timer = null;

/**
 * Announce `message` in the live region. A newer call replaces a pending one,
 * so rapid changes (typing in the search box) announce only the last result.
 * @param {string} message - Text to announce
 * @param {number} [delay=250] - Milliseconds to wait before announcing
 */
export function announce(message, delay = 250) {
  const region = document.getElementById("live");
  if (!region) return;
  clearTimeout(timer);
  // Clearing first makes a repeated identical message announce again.
  region.textContent = "";
  timer = setTimeout(() => {
    region.textContent = message;
  }, delay);
}
