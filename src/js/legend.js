// Legend popover anchored under the header count pill. Each row is a toggle
// for the visited / not-visited quick filter.

const MARGIN = 16;
const MAX_WIDTH = 260;
const GAP = 8;

// Rows: [css class, label, filter value].
const ROWS = [
  ["visited", "Visited", true],
  ["not-visited", "Not visited", false],
];

/**
 * Fill the legend popover and wire its rows and positioning.
 * @param {object} options
 * @param {HTMLElement} options.trigger - Count pill that opens the popover
 * @param {HTMLElement} options.popover - Element with the `popover` attribute
 * @param {number} options.visited - Number of visited units
 * @param {number} options.total - Total number of units
 * @param {Function} options.onSelect - Called with true, false, or null
 * @return {{setActive: Function}} `setActive(value)` reflects the current filter
 */
export function createLegend({ trigger, popover, visited, total, onSelect }) {
  let active = null;
  const counts = [visited, total - visited];

  popover.replaceChildren();
  const buttons = ROWS.map(([cls, label, value], i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-row";
    button.dataset.value = String(value);
    button.setAttribute("aria-pressed", "false");

    const swatch = document.createElement("span");
    swatch.className = `legend-swatch ${cls}`;
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "legend-label";
    text.textContent = label;

    const count = document.createElement("span");
    count.className = "legend-count";
    count.textContent = String(counts[i]);

    button.append(swatch, text, count);
    // A second click on the active row clears the filter.
    button.addEventListener("click", () =>
      onSelect(active === value ? null : value),
    );
    popover.append(button);
    return [button, value];
  });

  /**
   * Position the popover under the trigger, clamped inside the viewport.
   */
  function place() {
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(MAX_WIDTH, viewport - 2 * MARGIN);
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      MARGIN,
      Math.min(rect.right - width, viewport - width - MARGIN),
    );
    popover.style.left = `${left}px`;
    popover.style.top = `${rect.bottom + GAP}px`;
  }

  popover.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") place();
  });
  window.addEventListener("resize", () => {
    if (popover.matches(":popover-open")) place();
  });

  return {
    setActive(value) {
      active = value;
      for (const [button, rowValue] of buttons) {
        button.setAttribute("aria-pressed", String(rowValue === value));
      }
    },
  };
}
