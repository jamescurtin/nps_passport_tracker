import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

const svg = (page) => page.locator("svg.svg-content-responsive");

test("Trips lists every trip and a pick draws its route", async ({ page }) => {
  await openMap(page);
  await page.locator(".trips-toggle").click();
  const sheet = page.locator("#trips-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet).toHaveAttribute("data-mode", "card");
  const rows = sheet.locator(".trip-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(16);
  await maybeScreenshot(page, "desktop-trips-list");

  await sheet.locator('[data-trip-id="2024-06-mid-atlantic"]').click();
  await expect(page).toHaveURL(/#\/trip\/2024-06-mid-atlantic$/);
  await expect(sheet.locator(".sheet-title")).toHaveText("Mid-Atlantic");
  const stops = sheet.locator(".trip-stop-row");
  await expect(stops).toHaveCount(23);
  await expect(page.locator(".trip-leg")).toHaveCount(22);
  await expect(page.locator(".park-marker.trip-stop")).toHaveCount(23);
  await expect(svg(page)).toHaveClass(/zoomed/);
  await maybeScreenshot(page, "desktop-trip-mid-atlantic");

  // Another trip swaps in place: no history entry, new route.
  await sheet.locator(".trip-back").click();
  await expect(page.locator(".trip-leg")).toHaveCount(0);
  await sheet.locator('[data-trip-id="2023-05-california"]').click();
  await expect(page.locator(".trip-leg")).toHaveCount(10);
  await maybeScreenshot(page, "desktop-trip-california");

  // Escape closes the sheet and leaves the trip.
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
  await expect(page.locator(".trip-leg")).toHaveCount(0);
  await expect(page.locator(".park-marker.trip-stop")).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/trip\//);
  await expect(svg(page)).not.toHaveClass(/zoomed/);
});

test("#/trip/<id> deep link shows the trip; Back leaves it", async ({
  page,
}) => {
  await page.goto("/#/trip/2022-11-nyc");
  const sheet = page.locator("#trips-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet.locator(".sheet-title")).toHaveText("New York City");
  await expect(page.locator(".trip-leg")).toHaveCount(6);

  // A stop opens its park over the trip; Back returns to the trip.
  await sheet
    .getByRole("button", {
      name: "Statue Of Liberty National Monument",
      exact: true,
    })
    .click();
  await expect(page.locator("#park-sheet")).toHaveAttribute("open", "");
  await expect(page).toHaveURL(/#\/park\/stli$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/trip\/2022-11-nyc$/);
  await expect(page.locator("#park-sheet")).not.toHaveAttribute("open");
  await expect(page.locator(".trip-leg")).toHaveCount(6);
});

test("zooming to a state leaves the trip", async ({ page }) => {
  await page.goto("/#/trip/2022-11-nyc");
  await expect(page.locator(".trip-leg")).toHaveCount(6);
  await page.goto("/#/state/MA");
  await expect(page.locator(".trip-leg")).toHaveCount(0);
  await expect(page.locator("#trips-sheet")).not.toHaveAttribute("open");
  await expect(page.locator(".parks-in-state-toggle .btn-label")).toHaveText(
    "Parks in Massachusetts",
  );
});

test("an unknown trip id is ignored", async ({ page }) => {
  await page.goto("/#/trip/nope");
  await openMap(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".trip-leg")).toHaveCount(0);
});
