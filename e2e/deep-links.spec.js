import { test, expect } from "@playwright/test";

import { openMap } from "./helpers";

test("#/park/<code> opens that park's sheet", async ({ page }) => {
  await page.goto("/#/park/yell");
  const sheet = page.locator("#park-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(sheet.locator(".park-name-heading")).toHaveText(
    "Yellowstone National Park",
  );
  // The park's state is zoomed too.
  await expect(page.locator("svg.svg-content-responsive")).toHaveClass(
    /zoomed/,
  );
  await expect(page).toHaveURL(/#\/park\/yell$/);
});

test("#/state/<ABBR> zooms to the state and opens no sheet", async ({
  page,
}) => {
  await page.goto("/#/state/MA");
  await expect(page.locator("svg.svg-content-responsive")).toHaveClass(
    /zoomed/,
  );
  await expect(page.locator(".parks-in-state-toggle .btn-label")).toHaveText(
    "Parks in Massachusetts",
  );
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("unknown routes are ignored", async ({ page }) => {
  for (const hash of ["#/park/zzzz", "#/state/ZZ", "#nonsense"]) {
    await page.goto(`/${hash}`);
    await openMap(page);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator("svg.svg-content-responsive")).not.toHaveClass(
      /zoomed/,
    );
  }
});

test("the UI writes the route and Back closes the park sheet", async ({
  page,
}) => {
  await openMap(page);
  const history = () => page.evaluate(() => window.history.length);
  const before = await history();

  await page.locator('path[aria-label^="Massachusetts,"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/state\/MA$/);
  // Zooming replaces the entry: no history spam.
  expect(await history()).toBe(before);

  const marker = page.locator('.park-marker[tabindex="0"]').first();
  const code = await marker.getAttribute("data-park-code");
  await marker.focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("#park-sheet");
  await expect(sheet).toHaveAttribute("open", "");
  await expect(page).toHaveURL(new RegExp(`#/park/${code}$`));

  await page.goBack();
  await expect(sheet).not.toHaveAttribute("open");
  await expect(page).toHaveURL(/#\/state\/MA$/);
  // The state stays zoomed.
  await expect(page.locator(".parks-in-state-toggle .btn-label")).toHaveText(
    "Parks in Massachusetts",
  );
});

test("closing the sheet and resetting the map clear the route", async ({
  page,
}) => {
  await page.goto("/#/park/yell");
  await expect(page.locator("#park-sheet")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("#park-sheet")).not.toHaveAttribute("open");
  // A state is still zoomed, so the route falls back to it.
  await expect(page).toHaveURL(/#\/state\/(WY|MT|ID)$/);
  // A tap on the ocean resets the map.
  await page.locator("svg .background").dispatchEvent("click");
  await expect(page).not.toHaveURL(/#/);
});

test("a hash change drives the UI", async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => {
    window.location.hash = "#/park/yell";
  });
  await expect(page.locator("#park-sheet")).toHaveAttribute("open", "");
  await page.evaluate(() => {
    window.location.hash = "";
  });
  await expect(page.locator("#park-sheet")).not.toHaveAttribute("open");
  await expect(page.locator("svg.svg-content-responsive")).not.toHaveClass(
    /zoomed/,
  );
});

test("Copy link writes the park URL to the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/park/yell");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("#live")).toHaveText("Link copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/#\/park\/yell$/);
  expect(new URL(text).origin).toBe(new URL(page.url()).origin);
});
