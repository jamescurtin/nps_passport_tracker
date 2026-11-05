import { test, expect } from "@playwright/test";

import { openMap } from "./helpers";

test("the built site renders offline after one visit", async ({
  page,
  context,
}) => {
  await openMap(page);
  // `ready` resolves once a worker is active; it installs the precache.
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Wait for the page to be controlled (claim on first activation).
  await page.waitForFunction(() => navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".toolbar")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("path.state, path.state-complete")).toHaveCount(56);
  await expect(page.locator(".park-marker").first()).toBeAttached();
  expect(await page.locator(".park-marker").count()).toBeGreaterThan(300);
});

test("the manifest and its icons are served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await request.get(new URL(href, page.url()).href);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, page.url()).href);
    expect(res.ok(), icon.src).toBe(true);
  }
});
