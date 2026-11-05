import { describe, it, expect } from "vitest";

import { routeRequest } from "../src/js/sw_routing";

const ORIGIN = "https://nps.jamesandelize.com";

describe("routeRequest", () => {
  it.each([
    [`${ORIGIN}/`, "shell"],
    [`${ORIGIN}/index.html`, "shell"],
    [`${ORIGIN}/index.bundle.js`, "shell"],
    [`${ORIGIN}/runtime.bundle.js`, "shell"],
    [`${ORIGIN}/favicon.ico`, "shell"],
    [`${ORIGIN}/icon.svg`, "shell"],
    [`${ORIGIN}/manifest.webmanifest`, "shell"],
    [`${ORIGIN}/239fc4503c8b120027cf.png`, "shell"],
  ])("%s is the app shell", (url, expected) => {
    expect(routeRequest(url, ORIGIN)).toBe(expected);
  });

  it.each([
    [`${ORIGIN}/2ffb08a31e725838375a.json`],
    [`${ORIGIN}/states-10m.json?v=1`],
  ])("%s is data", (url) => {
    expect(routeRequest(url, ORIGIN)).toBe("data");
  });

  it.each([
    ["https://www.nps.gov/common/uploads/photo.jpg"],
    ["https://www.nps.gov/common/uploads/photo.PNG"],
    ["https://home.nps.gov/images/a.webp?x=1"],
  ])("%s is an image", (url) => {
    expect(routeRequest(url, ORIGIN)).toBe("image");
  });

  it.each([
    ["https://www.nps.gov/yell/index.htm"],
    ["https://example.com/photo.jpg"],
    ["https://notnps.gov/photo.jpg"],
    ["https://nominatim.openstreetmap.org/search?q=boston"],
    [`${ORIGIN}/sw.js`],
    ["chrome-extension://abc/page.js"],
    ["data:image/png;base64,AAAA"],
  ])("%s bypasses the worker", (url) => {
    expect(routeRequest(url, ORIGIN)).toBe("bypass");
  });

  it("accepts a URL object and resolves relative URLs against the origin", () => {
    expect(routeRequest(new URL(`${ORIGIN}/a.json`), ORIGIN)).toBe("data");
    expect(routeRequest("/a.json", ORIGIN)).toBe("data");
  });

  it("bypasses garbage", () => {
    expect(routeRequest("not a url", "")).toBe("bypass");
  });
});
