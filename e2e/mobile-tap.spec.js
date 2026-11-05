import { test, expect } from "@playwright/test";

import { maybeScreenshot, openMap } from "./helpers";

test("a tap on a state zooms it; a tap on a zoomed marker opens a peek card", async ({
  page,
}) => {
  await openMap(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);

  const svg = page.locator("#map-container svg");
  const massachusetts = page.locator('path[aria-label^="Massachusetts,"]');
  await expect(massachusetts).toHaveCount(1);

  // Tap a point that is inside Massachusetts and on top of at least one park
  // dot (the defect: the dot took the tap). Prefer the box centre.
  const target = await massachusetts.evaluate((state) => {
    const box = state.getBoundingClientRect();
    const svgEl = state.ownerSVGElement;
    const inside = (x, y) => {
      const point = svgEl.createSVGPoint();
      point.x = x;
      point.y = y;
      const local = point.matrixTransform(state.getScreenCTM().inverse());
      return state.isPointInFill(local);
    };
    const dots = [...document.querySelectorAll(".park-dot")].map((dot) => {
      const r = dot.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    const candidates = [[box.left + box.width / 2, box.top + box.height / 2]];
    for (const [x, y] of dots) {
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        candidates.push([x, y]);
      }
    }
    const onDot = ([x, y]) =>
      dots.some(([dx, dy]) => Math.hypot(dx - x, dy - y) <= 3);
    const hit =
      candidates.find((c) => inside(...c) && onDot(c)) ||
      candidates.find((c) => inside(...c));
    return { x: hit[0] - box.left, y: hit[1] - box.top, onDot: onDot(hit) };
  });
  // The tap must land on a dot, or this test could not catch the defect.
  expect(target.onDot).toBe(true);

  // force: Playwright's hit check would otherwise wait for the dot to stop
  // covering the state, which is the defect under test.
  await massachusetts.tap({
    position: { x: target.x, y: target.y },
    force: true,
  });
  await expect(svg).toHaveClass(/\bzoomed\b/);
  await expect(page.locator("#park-sheet[open]")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Now inside the zoomed state, a marker takes the tap. Use the first
  // tabbable marker whose centre is not covered by a neighbour's touch
  // target (Boston-area sites overlap even when zoomed).
  const code = await page.evaluate(() => {
    const markers = document.querySelectorAll('.park-marker[tabindex="0"]');
    for (const marker of markers) {
      const r = marker.querySelector(".park-dot").getBoundingClientRect();
      const top = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      if (top && top.closest(".park-marker") === marker) {
        return marker.dataset.parkCode;
      }
    }
    return null;
  });
  expect(code).not.toBeNull();
  await page.locator(`.park-marker[data-park-code="${code}"]`).tap();
  const card = page.locator("#park-sheet[open]");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-snap", "peek");

  const viewport = page.viewportSize();
  const cardBox = await card.boundingBox();
  expect(cardBox.height).toBeGreaterThanOrEqual(viewport.height * 0.4);
  expect(cardBox.height).toBeLessThanOrEqual(viewport.height * 0.55);

  // The map stays visible (and interactive) above the card.
  const mapBox = await page.locator("#map-container").boundingBox();
  expect(cardBox.y - mapBox.y).toBeGreaterThan(viewport.height * 0.25);
  await expect(page.locator("#map-container")).not.toHaveAttribute("inert");
  await maybeScreenshot(page, "mobile-peek-card");
});

test("a tap on another state closes the card and zooms in one tap", async ({
  page,
}) => {
  await openMap(page);
  // Keyboard path to a park in Massachusetts: zoom, then Enter on a marker.
  await page.locator('path[aria-label^="Massachusetts,"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#map-container svg")).toHaveClass(/\bzoomed\b/);
  await page.locator('.park-marker[tabindex="0"]').first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#park-sheet[open]")).toHaveCount(1);

  // A neighbouring state, visible above the card.
  const newHampshire = page.locator('path[aria-label^="New Hampshire,"]');
  const box = await newHampshire.boundingBox();
  const card = await page.locator("#park-sheet").boundingBox();
  const y = Math.min(box.y + box.height / 2, card.y - 10);
  await page.touchscreen.tap(box.x + box.width / 2, y);
  await expect(page.locator("#park-sheet[open]")).toHaveCount(0);
  await expect(newHampshire).toHaveAttribute("aria-pressed", "true");
});
