// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import {
  activateOnKey,
  markerLabel,
  stateLabel,
  syncMarkerTabindex,
} from "../src/js/keyboard";

function makeMarkers(codes) {
  return codes.map((code) => {
    const el = document.createElement("g");
    el.dataset.parkCode = code;
    el.setAttribute("tabindex", "-1");
    return el;
  });
}

describe("syncMarkerTabindex", () => {
  it("makes only markers in the active state tabbable", () => {
    const markers = makeMarkers(["a", "b", "c"]);
    syncMarkerTabindex(markers, new Set(["a", "c"]));
    expect(markers.map((m) => m.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "0",
    ]);
  });

  it("resets every marker to -1 on null", () => {
    const markers = makeMarkers(["a", "b"]);
    syncMarkerTabindex(markers, new Set(["a", "b"]));
    syncMarkerTabindex(markers, null);
    expect(markers.map((m) => m.getAttribute("tabindex"))).toEqual([
      "-1",
      "-1",
    ]);
  });

  it("moves the tab stops when another state becomes active", () => {
    const markers = makeMarkers(["a", "b"]);
    syncMarkerTabindex(markers, new Set(["a"]));
    syncMarkerTabindex(markers, new Set(["b"]));
    expect(markers.map((m) => m.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });

  it("keeps filtered-out markers out of the tab order", () => {
    const markers = makeMarkers(["a", "b"]);
    markers[0].classList.add("filtered-out");
    syncMarkerTabindex(markers, new Set(["a", "b"]));
    expect(markers.map((m) => m.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });
});

describe("activateOnKey", () => {
  const press = (listener, init) => {
    const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
    listener(event);
    return event;
  };

  it("calls the handler on Enter and Space", () => {
    const handler = vi.fn();
    const listener = activateOnKey(handler);
    const enter = press(listener, { key: "Enter" });
    const space = press(listener, { key: " " });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(enter.defaultPrevented).toBe(true);
    expect(space.defaultPrevented).toBe(true);
  });

  it("ignores other keys", () => {
    const handler = vi.fn();
    const listener = activateOnKey(handler);
    for (const key of ["Escape", "Tab", "a", "ArrowDown"]) {
      const event = press(listener, { key });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores modified keys and auto-repeat", () => {
    const handler = vi.fn();
    const listener = activateOnKey(handler);
    press(listener, { key: "Enter", metaKey: true });
    press(listener, { key: "Enter", ctrlKey: true });
    press(listener, { key: " ", altKey: true });
    press(listener, { key: "Enter", repeat: true });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("labels", () => {
  it("formats state and marker labels", () => {
    expect(stateLabel("Utah", 3, 14)).toBe("Utah, 3 of 14 sites visited");
    expect(markerLabel("Arches National Park", 1)).toBe(
      "Arches National Park, visited",
    );
    expect(markerLabel("Zion", 0)).toBe("Zion, not visited");
  });
});
