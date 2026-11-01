// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import { createLegend } from "../src/js/legend";

function setup() {
  const trigger = document.createElement("button");
  const popover = document.createElement("div");
  document.body.append(trigger, popover);
  const selected = [];
  const legend = createLegend({
    trigger,
    popover,
    visited: 97,
    total: 437,
    onSelect: (value) => selected.push(value),
  });
  return { popover, legend, selected };
}

describe("createLegend", () => {
  it("renders visited and not-visited counts", () => {
    const { popover } = setup();
    const rows = [...popover.querySelectorAll(".legend-row")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "Visited97",
      "Not visited340",
    ]);
  });

  it("selects a row, and a second click on the active row clears it", () => {
    const { popover, legend, selected } = setup();
    const [visited] = popover.querySelectorAll(".legend-row");
    visited.click();
    legend.setActive(true);
    expect(visited.getAttribute("aria-pressed")).toBe("true");
    visited.click();
    expect(selected).toEqual([true, null]);
  });

  it("reflects an external filter change", () => {
    const { popover, legend } = setup();
    const [visited, notVisited] = popover.querySelectorAll(".legend-row");
    legend.setActive(false);
    expect(visited.getAttribute("aria-pressed")).toBe("false");
    expect(notVisited.getAttribute("aria-pressed")).toBe("true");
  });
});
