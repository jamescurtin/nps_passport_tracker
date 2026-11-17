import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

test("Timeline is a short card with the chart and slider in view", async ({
  page,
}) => {
  await openMap(page);
  await page.locator(".timeline-toggle").click();
  const sheet = page.locator("#timeline-sheet");
  await expect(sheet).toHaveAttribute("data-mode", "sheet");
  const slider = sheet.locator(".timeline-slider");
  await expect(slider).toBeInViewport();
  const box = await sheet.locator(".sheet-panel").boundingBox();
  const viewport = page.viewportSize();
  // Leaves most of the map visible.
  expect(box.height).toBeLessThan(viewport.height * 0.45);
  await slider.fill("2500");
  await expect(sheet.locator(".timeline-count")).not.toHaveText("0");
  await maybeScreenshot(page, "mobile-timeline");
});
