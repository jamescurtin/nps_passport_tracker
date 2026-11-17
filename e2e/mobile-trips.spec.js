import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

test("Trips opens as a peek card and the route stays visible above it", async ({
  page,
}) => {
  await openMap(page);
  await page.locator(".trips-toggle").click();
  const sheet = page.locator("#trips-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet).toHaveAttribute("data-mode", "sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await maybeScreenshot(page, "mobile-trips-list");

  await sheet.locator('[data-trip-id="2026-11-dc-ohio"]').click();
  await expect(page.locator(".trip-leg")).toHaveCount(10);

  // Every stop is drawn inside the map area above the card.
  const sheetTop = (await sheet.boundingBox()).y;
  const mapBox = await page.locator("#map-container").boundingBox();
  const dots = page.locator(".park-marker.trip-stop .park-dot");
  await expect(dots).toHaveCount(11);
  for (const box of await dots.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON()),
  )) {
    expect(box.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(sheetTop);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(mapBox.width);
  }
  await maybeScreenshot(page, "mobile-trip-dc-ohio");

  // A stop's park card replaces the trips card; the route stays.
  await sheet.locator(".trip-stop-name").first().click();
  await expect(page.locator("#park-sheet")).toHaveAttribute("open", "");
  await expect(sheet).not.toHaveAttribute("open");
  await expect(page.locator(".trip-leg")).toHaveCount(10);

  // Trips reopens on the same trip.
  await page.locator("#park-sheet .sheet-close").click();
  await page.locator(".trips-toggle").click();
  await expect(sheet.locator(".sheet-title")).toHaveText(
    "DC, Pennsylvania & Ohio",
  );
});
