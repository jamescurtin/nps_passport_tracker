// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { copyLink } from "../src/js/copy_link";
import { registerServiceWorker } from "../src/js/register_sw";

describe("copyLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="live"></div><div id="box"></div>';
  });
  afterEach(() => vi.useRealTimers());

  it("writes to the clipboard and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue();
    const box = document.getElementById("box");
    const ok = await copyLink("https://x.test/#/park/yell", box, {
      clipboard: { writeText },
    });
    vi.advanceTimersByTime(10);
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://x.test/#/park/yell");
    expect(document.getElementById("live").textContent).toBe("Link copied");
    expect(box.querySelector(".link-field")).toBeNull();
  });

  it("falls back to a selected field when the clipboard fails", async () => {
    const box = document.getElementById("box");
    const ok = await copyLink("https://x.test/#/park/yell", box, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const field = box.querySelector(".link-field");
    expect(ok).toBe(false);
    expect(field.value).toBe("https://x.test/#/park/yell");
    expect(document.activeElement).toBe(field);
  });

  it("falls back when there is no clipboard API", async () => {
    const box = document.getElementById("box");
    expect(await copyLink("https://x.test/", box, {})).toBe(false);
    expect(box.querySelector(".link-field")).not.toBeNull();
  });
});

describe("registerServiceWorker", () => {
  it("registers on load when supported", () => {
    const register = vi.fn().mockResolvedValue();
    const win = new EventTarget();
    registerServiceWorker({ serviceWorker: { register } }, win);
    expect(register).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledWith("sw.js");
  });

  it("does nothing without service worker support", () => {
    const win = new EventTarget();
    const spy = vi.spyOn(win, "addEventListener");
    registerServiceWorker({}, win);
    expect(spy).not.toHaveBeenCalled();
  });
});
