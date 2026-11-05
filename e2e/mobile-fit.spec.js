import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

/**
 * Assert every state path's box lies within #map-container (1px tolerance).
 * @param {import("@playwright/test").Page} page
 */
async function expectStatesInsideContainer(page) {
  const result = await page.evaluate(() => {
    const container = document
      .getElementById("map-container")
      .getBoundingClientRect();
    return {
      container: {
        left: container.left,
        top: container.top,
        right: container.right,
        bottom: container.bottom,
      },
      states: [
        ...document.querySelectorAll("path.state, path.state-complete"),
      ].map((path) => {
        const r = path.getBoundingClientRect();
        return {
          name: path.getAttribute("aria-label").split(",")[0],
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      }),
    };
  });
  const { container, states } = result;
  expect(states).toHaveLength(56);
  for (const s of states) {
    expect(s.width * s.height, `${s.name} is drawn`).toBeGreaterThan(0);
    expect(s.left, `${s.name} left`).toBeGreaterThanOrEqual(container.left - 1);
    expect(s.top, `${s.name} top`).toBeGreaterThanOrEqual(container.top - 1);
    expect(s.right, `${s.name} right`).toBeLessThanOrEqual(container.right + 1);
    expect(s.bottom, `${s.name} bottom`).toBeLessThanOrEqual(
      container.bottom + 1,
    );
  }
}

test("the whole map fits the container in portrait and landscape", async ({
  page,
}) => {
  await openMap(page);
  await expectStatesInsideContainer(page);
  await maybeScreenshot(page, "mobile-portrait-map");

  await page.setViewportSize({ width: 844, height: 390 });
  // handleResize is debounced; wait for the SVG to take the new size.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const svg = document.querySelector("#map-container svg");
        const box = document
          .getElementById("map-container")
          .getBoundingClientRect();
        return Number(svg.getAttribute("width")) === Math.round(box.width);
      }),
    )
    .toBe(true);
  await expectStatesInsideContainer(page);
  await maybeScreenshot(page, "mobile-landscape-map");
});
