import { test, expect } from "@playwright/test";

import { openMap } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openMap(page);
});

test("Search opens as a dialog and Escape closes it", async ({ page }) => {
  await page.locator("#search-toggle").click();
  const sheet = page.locator("#search-container");
  await expect(sheet).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
});

test("Stats opens as a modal dialog and Escape closes it", async ({ page }) => {
  await page.locator(".stats-toggle").click();
  const sheet = page.locator("#stats-dashboard");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet).toHaveAttribute("data-mode", "dialog");
  await expect(page.locator("#map-container")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
  await expect(page.locator("#map-container")).not.toHaveAttribute("inert");
});

test("the state park list opens as a modal dialog and Escape closes it", async ({
  page,
}) => {
  // Keyboard, not a click: a click at full-map scale can land on a dot.
  await page.locator('path[aria-label^="Massachusetts,"]').focus();
  await page.keyboard.press("Enter");
  const button = page.locator(".parks-in-state-toggle");
  await expect(button).toBeVisible();
  await button.click();
  const sheet = page.locator("#state-park-list");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet).toHaveAttribute("data-mode", "dialog");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
});

test("the park sheet stays a centred modal dialog on desktop", async ({
  page,
}) => {
  await page.locator('path[aria-label^="Massachusetts,"]').focus();
  await page.keyboard.press("Enter");
  await page.locator('.park-marker[tabindex="0"]').first().focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("#park-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet).toHaveAttribute("data-mode", "dialog");
  await expect(page.locator("#map-container")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
});
