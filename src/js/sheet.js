// Sheet primitive shared by every overlay (park details, statistics, search,
// state park list). See Phase 3 of docs/plans/2026-11-01-ui-uplevel.md.
//
// Every sheet is a native <dialog>:
// - modal sheets open with showModal() (focus trap, Escape, ::backdrop);
// - non-modal sheets open with show() and leave the map interactive.
// The layout is picked in JS at open time and written to `data-mode`; all
// sheet CSS keys off that attribute so JS and CSS cannot disagree:
// - "dialog": desktop, modal -> centered dialog
// - "card":   desktop, non-modal -> floating card at `data-anchor`
// - "sheet":  mobile, any -> bottom sheet with a drag handle
//
// Nothing here touches the DOM or `window` at import time, so modules that
// import this file stay testable in the node environment.

import * as icons from "./icons";

const MOBILE_QUERY = "(max-width: 768px)";
// Page chrome made inert while any modal sheet is open.
const INERT_SELECTORS = ["#map-container", ".app-bar", ".toolbar"];
// Drag-to-dismiss thresholds: fraction of sheet height, or a fast flick.
const DISMISS_DISTANCE_RATIO = 0.25;
const DISMISS_VELOCITY = 0.5; // px per ms
const DISMISS_MIN_FLICK = 24; // px

// Open sheets, oldest first. The last entry is the innermost.
const registry = [];
let mobileQuery = null;
let sheetCount = 0;

/**
 * Lazily create the mobile media query and re-apply the mode of open sheets
 * when it flips (rotation, resize across the breakpoint).
 * @return {MediaQueryList|null} The query, or null without matchMedia
 */
function getMobileQuery() {
  if (!mobileQuery && typeof window !== "undefined" && window.matchMedia) {
    mobileQuery = window.matchMedia(MOBILE_QUERY);
    mobileQuery.addEventListener("change", () => {
      registry.forEach((sheet) => sheet.applyMode());
    });
  }
  return mobileQuery;
}

/**
 * @return {boolean} true below the mobile breakpoint
 */
function isMobile() {
  const query = getMobileQuery();
  return Boolean(query && query.matches);
}

/**
 * Set `inert` on the page chrome while any open sheet is modal. Computed from
 * the whole registry so closing an inner sheet keeps the outer one's effect.
 */
function syncInert() {
  const anyModal = registry.some((sheet) => sheet.modal);
  INERT_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.toggleAttribute("inert", anyModal);
    });
  });
}

/**
 * Move focus back after a sheet closes. A live opener gets focus (if it
 * cannot take focus, e.g. an SVG marker, focus is left alone). A removed
 * opener falls back to the parent sheet's close button, else the toolbar's
 * first button.
 * @param {Element|null} target - Element focused before the sheet opened
 */
function restoreFocusTo(target) {
  if (!target || target === document.body) return;
  if (target.isConnected) {
    if (typeof target.focus === "function") target.focus();
    return;
  }
  const parent = registry[registry.length - 1];
  if (parent) {
    parent.focusClose();
    return;
  }
  const fallback = document.querySelector(".toolbar button");
  if (fallback) fallback.focus();
}

/**
 * Close the most recently opened sheet (used by the global Escape handler).
 * @return {boolean} true if a sheet was open and is now closing
 */
export function closeTopSheet() {
  const top = registry[registry.length - 1];
  if (!top) return false;
  top.close({ reason: "escape" });
  return true;
}

/**
 * Create a sheet. The element is appended to `parent` (default `#sheets`).
 * @param {object} options
 * @param {string} options.id - Element id of the <dialog>
 * @param {string} options.title - Header title text
 * @param {boolean} [options.modal=true] - Modal dialog vs. non-modal card
 * @param {"center"|"bottom-left"} [options.anchor="center"] - Desktop position
 * @param {boolean} [options.hideTitle=false] - Keep the title for screen
 *   readers only (the body renders its own heading)
 * @param {string} [options.className] - Extra classes for the <dialog>
 * @param {Element} [options.parent] - Container for the <dialog>
 * @param {Function} [options.onClose] - Called with the close reason
 *   ("user", "escape", "backdrop", "drag", "native", or the caller's own) as
 *   soon as the sheet closes, before focus is restored
 * @return {object} `{ el, body, header, open, close, isOpen, setTitle }`
 */
export function createSheet({
  id,
  title = "",
  modal = true,
  anchor = "center",
  hideTitle = false,
  className = "",
  parent,
  onClose,
} = {}) {
  getMobileQuery();
  sheetCount += 1;
  const titleId = `${id || `sheet-${sheetCount}`}-title`;

  const el = document.createElement("dialog");
  if (id) el.id = id;
  el.className = `sheet ${className}`.trim();
  el.dataset.anchor = anchor;
  el.setAttribute("aria-labelledby", titleId);

  // Inner panel fills the dialog, so a click whose target is the <dialog>
  // itself can only come from the backdrop.
  const panel = document.createElement("div");
  panel.className = "sheet-panel";

  const header = document.createElement("header");
  header.className = "sheet-header";

  const handle = document.createElement("div");
  handle.className = "sheet-handle";
  handle.setAttribute("aria-hidden", "true");

  const headerRow = document.createElement("div");
  headerRow.className = "sheet-header-row";

  const titleEl = document.createElement(hideTitle ? "span" : "h2");
  titleEl.className = "sheet-title";
  titleEl.id = titleId;
  titleEl.textContent = title;
  if (hideTitle) titleEl.dataset.hidden = "";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sheet-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.innerHTML = icons.close;

  // Optional header content below the title row (e.g. a progress line).
  const headerExtra = document.createElement("div");
  headerExtra.className = "sheet-header-extra";

  const body = document.createElement("div");
  body.className = "sheet-body";

  headerRow.append(titleEl, closeButton);
  header.append(handle, headerRow, headerExtra);
  panel.append(header, body);
  el.append(panel);
  (parent || document.getElementById("sheets") || document.body).append(el);

  let openState = false;
  let lastFocused = null;

  const sheet = {
    el,
    body,
    header: headerExtra,
    modal,
    open,
    close,
    isOpen: () => openState,
    setTitle: (text) => {
      titleEl.textContent = text;
    },
    applyMode,
    focusClose: () => closeButton.focus(),
  };

  function applyMode() {
    el.dataset.mode = isMobile() ? "sheet" : modal ? "dialog" : "card";
  }

  /**
   * Open the sheet. No-op when already open.
   * @param {object} [options]
   * @param {Element} [options.opener] - Element to refocus on close
   *   (defaults to the focused element)
   */
  function open({ opener } = {}) {
    if (openState) return;
    lastFocused = opener || document.activeElement;
    openState = true;
    registry.push(sheet);
    applyMode();
    if (!el.open) {
      if (modal) el.showModal();
      else el.show();
    }
    syncInert();
    // The entry animation comes from `@starting-style` on `[open]`.
    closeButton.focus();
  }

  /**
   * Close the sheet. Everything happens synchronously: registry, isOpen(),
   * onClose, the <dialog> (so its ::backdrop stops blocking clicks), inert
   * and focus. The exit animation is pure CSS (`transition-behavior:
   * allow-discrete` keeps the closed dialog painted while it fades out).
   * @param {object} [options]
   * @param {string} [options.reason="user"] - Passed to onClose
   * @param {boolean} [options.restoreFocus=true] - Refocus the opener
   * @return {boolean} true if the sheet was open
   */
  function close({ reason = "user", restoreFocus = true } = {}) {
    if (!openState) return false;
    openState = false;
    const index = registry.indexOf(sheet);
    if (index !== -1) registry.splice(index, 1);
    if (onClose) onClose(reason);

    const focusTarget = restoreFocus ? lastFocused : null;
    lastFocused = null;
    if (el.open) el.close();
    syncInert();
    restoreFocusTo(focusTarget);
    return true;
  }

  closeButton.addEventListener("click", () => close());

  // Native Escape on a modal dialog: route through the registry instead.
  el.addEventListener("cancel", (event) => {
    event.preventDefault();
    close({ reason: "escape" });
  });

  // Closed by the browser without `cancel` (close watcher, form submit):
  // keep the registry in sync. Ignore the event from our own close, and
  // the case where the sheet was reopened before the event fired.
  el.addEventListener("close", () => {
    if (openState && !el.open) close({ reason: "native" });
  });

  // Backdrop click (modal only). Require the press to start on the backdrop
  // too, so a text selection dragged outside does not close the sheet.
  let pressedBackdrop = false;
  el.addEventListener("pointerdown", (event) => {
    pressedBackdrop = event.target === el;
  });
  el.addEventListener("click", (event) => {
    if (modal && pressedBackdrop && event.target === el) {
      close({ reason: "backdrop" });
    }
    pressedBackdrop = false;
  });

  attachDrag(sheet, header, closeButton);
  return sheet;
}

/**
 * Drag-to-dismiss on the bottom sheet header (mobile mode only). The header
 * has `touch-action: none` so touch drags reach us instead of scrolling.
 * @param {object} sheet - Sheet object from createSheet
 * @param {Element} header - Drag surface
 * @param {Element} closeButton - Excluded from starting a drag
 */
function attachDrag(sheet, header, closeButton) {
  const el = sheet.el;
  let drag = null;

  header.addEventListener("pointerdown", (event) => {
    if (el.dataset.mode !== "sheet" || !sheet.isOpen()) return;
    if (event.button !== 0 || closeButton.contains(event.target)) return;
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      startT: event.timeStamp,
      dy: 0,
    };
    header.setPointerCapture?.(event.pointerId);
    el.dataset.dragging = "";
  });

  header.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.dy = Math.max(0, event.clientY - drag.startY);
    el.style.transform = `translateY(${drag.dy}px)`;
  });

  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { dy, startT } = drag;
    drag = null;
    header.releasePointerCapture?.(event.pointerId);
    delete el.dataset.dragging;
    let dismiss = false;
    if (event.type === "pointerup") {
      const velocity = dy / Math.max(1, event.timeStamp - startT);
      const far =
        dy > el.getBoundingClientRect().height * DISMISS_DISTANCE_RATIO;
      const flick = velocity > DISMISS_VELOCITY && dy > DISMISS_MIN_FLICK;
      dismiss = far || flick;
    }
    // Close before clearing the inline transform, so the exit animation
    // starts from the dragged position instead of jumping back first.
    if (dismiss) sheet.close({ reason: "drag" });
    el.style.transform = "";
  };
  header.addEventListener("pointerup", end);
  header.addEventListener("pointercancel", end);
  // Capture can be lost without pointerup/pointercancel (e.g. element
  // removal); never leave `data-dragging` set.
  header.addEventListener("lostpointercapture", end);
}
