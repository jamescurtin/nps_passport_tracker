import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

const marker = (page, code) =>
  page.locator(`.park-marker[data-park-code="${code}"]`);

test("Timeline opens on today; scrubbing rewinds the map", async ({ page }) => {
  await openMap(page);
  await page.locator(".timeline-toggle").click();
  const sheet = page.locator("#timeline-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(page).toHaveURL(/#\/timeline$/);
  const count = sheet.locator(".timeline-count");
  const visited = Number(
    (await page.locator(".count-label").textContent()).match(/\d+/)[0],
  );
  await expect(count).toHaveText(String(visited));
  await expect(page.locator(".park-marker.tl-future")).toHaveCount(0);
  await maybeScreenshot(page, "desktop-timeline-today");

  // The first day on the slider: only Acadia (Aug 13, 2017).
  const slider = sheet.locator(".timeline-slider");
  await slider.fill("0");
  await expect(count).toHaveText("1");
  await expect(sheet.locator(".timeline-date")).toHaveText("by Aug 13, 2017");
  await expect(marker(page, "acad")).not.toHaveClass(/tl-future/);
  await expect(marker(page, "yose")).toHaveClass(/tl-future/);
  await expect(page.locator("path.tl-incomplete")).not.toHaveCount(0);
  await maybeScreenshot(page, "desktop-timeline-2017");

  // Reduced motion: Play jumps to today.
  await sheet.locator(".timeline-play").click();
  await expect(count).toHaveText(String(visited));
  await expect(page.locator(".park-marker.tl-future")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveAttribute("open");
  await expect(page.locator("g.timeline-mode")).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/timeline/);
});

test("#/timeline deep link; a trip replaces the timeline", async ({ page }) => {
  await page.goto("/#/timeline");
  await expect(page.locator("#timeline-sheet")).toHaveAttribute("open", "");
  await page.goto("/#/trip/2022-11-nyc");
  await expect(page.locator("#timeline-sheet")).not.toHaveAttribute("open");
  await expect(page.locator("g.timeline-mode")).toHaveCount(0);
  await expect(page.locator(".trip-leg")).toHaveCount(6);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("Play steps through the visits; Pause stops in place", async ({
    page,
  }) => {
    await page.goto("/#/timeline");
    const sheet = page.locator("#timeline-sheet");
    const play = sheet.locator(".timeline-play");
    const count = sheet.locator(".timeline-count");
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    // Starts over from before the first visit, then counts up.
    await expect(count).toHaveText("1", { timeout: 5000 });
    await expect
      .poll(async () => Number(await count.textContent()), { timeout: 8000 })
      .toBeGreaterThan(3);
    await maybeScreenshot(page, "desktop-timeline-playing");
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    const paused = await count.textContent();
    await page.waitForTimeout(1500);
    await expect(count).toHaveText(paused);
  });
});
