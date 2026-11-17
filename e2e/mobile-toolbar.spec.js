import { test, expect } from "@playwright/test";

import { openMap } from "./helpers";

// Phones show icon circles; from 769px the pills carry labels, and every
// shown label must fit uncut.
for (const width of [412, 430, 768, 900, 1024]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 915 } });

    for (const hash of ["", "#/state/MA"]) {
      test(`toolbar labels fit${hash ? " with a state zoomed" : ""}`, async ({
        page,
      }) => {
        await openMap(page);
        if (hash) {
          await page.goto(`/${hash}`);
          await expect(page.locator(".parks-in-state-toggle")).toBeVisible();
        }
        const clipped = await page
          .locator(".toolbar-btn:not([hidden]) .btn-label")
          .evaluateAll((els) =>
            els
              .filter((el) => el.offsetParent !== null)
              // Screen-reader-only labels (icon circles) are not shown.
              .filter((el) => getComputedStyle(el).position !== "absolute")
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => el.textContent),
          );
        expect(clipped).toEqual([]);
        if (width <= 768) {
          const widths = await page
            .locator(".toolbar-btn:not([hidden])")
            .evaluateAll((els) => els.map((el) => el.offsetWidth));
          expect(new Set(widths)).toEqual(new Set([48]));
        }
      });
    }
  });
}
