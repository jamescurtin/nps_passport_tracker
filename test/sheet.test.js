// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

// jsdom has no matchMedia and no <dialog> methods; stub the minimum.
let mobile = false;
const mediaListeners = [];

beforeAll(() => {
  window.matchMedia = (query) => ({
    media: query,
    get matches() {
      return mobile;
    },
    addEventListener: (_type, cb) => mediaListeners.push(cb),
    removeEventListener: () => {},
  });
  const proto = window.HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.show = function () {
      this.setAttribute("open", "");
    };
    proto.showModal = function () {
      this.setAttribute("open", "");
      this.dataset.testModal = "";
    };
    proto.close = function () {
      if (!this.open) return;
      this.removeAttribute("open");
      delete this.dataset.testModal;
      this.dispatchEvent(new window.Event("close"));
    };
  }
});

let createSheet;
let closeTopSheet;
let sheets = [];

beforeAll(async () => {
  ({ createSheet, closeTopSheet } = await import("../src/js/sheet"));
});

beforeEach(() => {
  mobile = false;
  document.body.innerHTML = `
    <header class="app-bar"></header>
    <main id="map-container"></main>
    <nav class="toolbar"><button id="opener">Open</button></nav>
    <div id="sheets"></div>`;
  sheets = [];
});

afterEach(() => {
  while (closeTopSheet()) {
    // drain the registry so tests stay independent
  }
});

function make(opts) {
  const sheet = createSheet({ title: "Test", ...opts });
  sheets.push(sheet);
  return sheet;
}

describe("createSheet", () => {
  it("builds a dialog with a shared header and body", () => {
    const sheet = make({ id: "a", title: "Hello" });
    expect(sheet.el.tagName).toBe("DIALOG");
    expect(sheet.el.parentElement.id).toBe("sheets");
    expect(sheet.el.querySelector(".sheet-title").textContent).toBe("Hello");
    expect(sheet.el.querySelector(".sheet-close svg")).not.toBeNull();
    expect(sheet.el.getAttribute("aria-labelledby")).toBe("a-title");
    sheet.setTitle("Changed");
    expect(sheet.el.querySelector(".sheet-title").textContent).toBe("Changed");
  });

  it("opens and closes, tracking isOpen and the dialog open state", () => {
    const sheet = make({ id: "a" });
    expect(sheet.isOpen()).toBe(false);
    sheet.open();
    expect(sheet.isOpen()).toBe(true);
    expect(sheet.el.open).toBe(true);
    expect(sheet.el.dataset.mode).toBe("dialog");
    expect(sheet.close()).toBe(true);
    expect(sheet.isOpen()).toBe(false);
    expect(sheet.el.open).toBe(false);
    expect(sheet.close()).toBe(false);
  });

  it("uses showModal for modal sheets and show for non-modal ones", () => {
    const modal = make({ id: "m" });
    const card = make({ id: "c", modal: false, anchor: "bottom-left" });
    card.open();
    expect(card.el.dataset.mode).toBe("card");
    expect(card.el.dataset.anchor).toBe("bottom-left");
    expect("testModal" in card.el.dataset).toBe(false);
    modal.open();
    expect("testModal" in modal.el.dataset).toBe(true);
  });

  it("picks bottom-sheet mode on mobile and re-evaluates on change", () => {
    const sheet = make({ id: "a" });
    mobile = true;
    sheet.open();
    expect(sheet.el.dataset.mode).toBe("sheet");
    mobile = false;
    mediaListeners.forEach((cb) => cb());
    expect(sheet.el.dataset.mode).toBe("dialog");
  });

  it("sets inert on page chrome while any modal sheet is open", () => {
    const outer = make({ id: "outer" });
    const inner = make({ id: "inner" });
    const map = document.getElementById("map-container");
    outer.open();
    inner.open();
    expect(map.hasAttribute("inert")).toBe(true);
    inner.close();
    // The outer modal sheet is still open.
    expect(map.hasAttribute("inert")).toBe(true);
    outer.close();
    expect(map.hasAttribute("inert")).toBe(false);
  });

  it("does not set inert for a non-modal sheet", () => {
    const card = make({ id: "c", modal: false });
    card.open();
    expect(document.querySelector(".toolbar").hasAttribute("inert")).toBe(
      false,
    );
  });
});

describe("registry", () => {
  it("closeTopSheet closes the most recently opened sheet first", () => {
    const a = make({ id: "a", modal: false });
    const b = make({ id: "b" });
    const c = make({ id: "c" });
    a.open();
    b.open();
    c.open();
    expect(closeTopSheet()).toBe(true);
    expect([a.isOpen(), b.isOpen(), c.isOpen()]).toEqual([true, true, false]);
    expect(closeTopSheet()).toBe(true);
    expect([a.isOpen(), b.isOpen(), c.isOpen()]).toEqual([true, false, false]);
    expect(closeTopSheet()).toBe(true);
    expect(a.isOpen()).toBe(false);
    expect(closeTopSheet()).toBe(false);
  });

  it("drops a sheet closed out of order from the registry", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b" });
    a.open();
    b.open();
    a.close();
    expect(closeTopSheet()).toBe(true);
    expect(b.isOpen()).toBe(false);
    expect(closeTopSheet()).toBe(false);
  });

  it("syncs the registry when the dialog closes natively", () => {
    const a = make({ id: "a" });
    a.open();
    a.el.close();
    expect(a.isOpen()).toBe(false);
    expect(closeTopSheet()).toBe(false);
  });

  it("routes the native cancel (Escape) through the registry", () => {
    const reasons = [];
    const a = make({ id: "a", onClose: (r) => reasons.push(r) });
    a.open();
    const cancel = new window.Event("cancel", { cancelable: true });
    a.el.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(a.isOpen()).toBe(false);
    expect(reasons).toEqual(["escape"]);
  });
});

describe("closing interactions", () => {
  it("closes on backdrop click only when the press started there", () => {
    const a = make({ id: "a" });
    a.open();
    // Press inside the panel, release on the backdrop: stays open.
    a.el
      .querySelector(".sheet-body")
      .dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    a.el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(a.isOpen()).toBe(true);
    // Press and release on the backdrop: closes.
    a.el.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    a.el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(a.isOpen()).toBe(false);
  });

  it("closes from the header close button and reports the reason", () => {
    const reasons = [];
    const a = make({ id: "a", onClose: (r) => reasons.push(r) });
    a.open();
    a.el.querySelector(".sheet-close").click();
    expect(a.isOpen()).toBe(false);
    expect(reasons).toEqual(["user"]);
  });
});

describe("focus", () => {
  it("moves focus to the close button on open and restores it on close", () => {
    const opener = document.getElementById("opener");
    opener.focus();
    const a = make({ id: "a" });
    a.open();
    expect(document.activeElement).toBe(a.el.querySelector(".sheet-close"));
    a.close();
    expect(document.activeElement).toBe(opener);
  });

  it("restores focus to an explicit opener", () => {
    const opener = document.getElementById("opener");
    const a = make({ id: "a" });
    a.open({ opener });
    a.close();
    expect(document.activeElement).toBe(opener);
  });

  it("restores focus through nested sheets", () => {
    const opener = document.getElementById("opener");
    opener.focus();
    const outer = make({ id: "outer" });
    outer.open();
    const row = document.createElement("button");
    outer.body.append(row);
    row.focus();
    const inner = make({ id: "inner" });
    inner.open();
    closeTopSheet();
    expect(document.activeElement).toBe(row);
    closeTopSheet();
    expect(document.activeElement).toBe(opener);
  });

  it("skips focus restore when asked", () => {
    const opener = document.getElementById("opener");
    opener.focus();
    const a = make({ id: "a" });
    a.open();
    a.close({ restoreFocus: false });
    expect(document.activeElement).not.toBe(opener);
  });

  it("calls onClose before restoring focus, so a hidden opener can reappear", () => {
    const opener = document.getElementById("opener");
    const a = make({
      id: "a",
      onClose: () => {
        opener.hidden = false;
      },
    });
    a.open({ opener });
    opener.hidden = true;
    a.close();
    expect(opener.hidden).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
