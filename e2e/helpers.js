import { expect } from "@playwright/test";

/**
 * Load the map and wait until every state and marker is drawn.
 * @param {import("@playwright/test").Page} page
 */
export async function openMap(page) {
  await page.goto("/");
  await expect(page.locator(".toolbar")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("path.state, path.state-complete")).toHaveCount(56);
}

/**
 * Save a screenshot when E2E_SCREENSHOT_DIR is set (manual review only).
 * @param {import("@playwright/test").Page} page
 * @param {string} name - File name without extension
 */
export async function maybeScreenshot(page, name) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}
