import { describe, it, expect, vi } from "vitest";

import { createRouter, formatHash, parseHash, parkUrl } from "../src/js/router";

describe("parseHash / formatHash", () => {
  it("parses park, state and reset routes", () => {
    expect(parseHash("#/park/yell")).toEqual({ type: "park", code: "yell" });
    expect(parseHash("#/state/MA")).toEqual({ type: "state", abbr: "MA" });
    expect(parseHash("")).toEqual({ type: "reset" });
    expect(parseHash("#")).toEqual({ type: "reset" });
    expect(parseHash("#/")).toEqual({ type: "reset" });
  });

  it("normalises case and accepts a hash without the leading #", () => {
    expect(parseHash("#/park/YELL")).toEqual({ type: "park", code: "yell" });
    expect(parseHash("#/state/ma")).toEqual({ type: "state", abbr: "MA" });
    expect(parseHash("/state/MA")).toEqual({ type: "state", abbr: "MA" });
  });

  it("returns null for unknown or malformed routes", () => {
    for (const hash of [
      "#about",
      "#/parks/yell",
      "#/park/",
      "#/state/",
      "#/park/a/b",
      "#/park/%E0%A4%A",
    ]) {
      expect(parseHash(hash)).toBeNull();
    }
  });

  it("round-trips", () => {
    expect(parseHash(formatHash({ park: "yell" }))).toEqual({
      type: "park",
      code: "yell",
    });
    expect(parseHash(formatHash({ state: "MA" }))).toEqual({
      type: "state",
      abbr: "MA",
    });
    expect(parseHash(formatHash({}))).toEqual({ type: "reset" });
  });

  it("prefers the park when both are set", () => {
    expect(formatHash({ park: "yell", state: "WY" })).toBe("#/park/yell");
  });

  it("builds a shareable park URL", () => {
    expect(parkUrl("yell", "https://nps.example/?a=1#/state/WY")).toBe(
      "https://nps.example/?a=1#/park/yell",
    );
  });
});

/**
 * Router wired to mock callbacks and a fake window.
 * @param {string} [hash] - Initial hash
 * @return {object} Router, mocks and the fake window
 */
function setup(hash = "") {
  const win = {
    location: { hash, pathname: "/", search: "?x=1" },
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn((_s, _t, url) => {
        const i = url.indexOf("#");
        win.location.hash = i === -1 ? "" : url.slice(i);
      }),
    },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  win.history.pushState.mockImplementation((_s, _t, url) => {
    const i = url.indexOf("#");
    win.location.hash = i === -1 ? "" : url.slice(i);
  });
  const parks = { yell: ["WY", "MT", "ID"], acad: ["ME"], nope: ["ZZ"] };
  const calls = {
    openPark: vi.fn(),
    closePark: vi.fn(),
    zoomState: vi.fn(),
    reset: vi.fn(),
  };
  const router = createRouter({
    win,
    parkStates: (code) => parks[code] ?? null,
    hasState: (abbr) => ["WY", "MT", "ID", "ME", "MA"].includes(abbr),
    ...calls,
  });
  return { router, win, ...calls };
}

describe("router apply", () => {
  it("opens a park and zooms to its state first", () => {
    const { router, openPark, zoomState } = setup();
    router.apply("#/park/yell");
    expect(zoomState).toHaveBeenCalledExactlyOnceWith("WY");
    expect(openPark).toHaveBeenCalledExactlyOnceWith("yell");
    expect(zoomState.mock.invocationCallOrder[0]).toBeLessThan(
      openPark.mock.invocationCallOrder[0],
    );
  });

  it("does not zoom when a state of the park is already zoomed", () => {
    const { router, openPark, zoomState } = setup();
    router.stateChanged("MT");
    router.apply("#/park/yell");
    expect(zoomState).not.toHaveBeenCalled();
    expect(openPark).toHaveBeenCalledWith("yell");
  });

  it("zooms to a state and opens nothing else", () => {
    const { router, openPark, zoomState, closePark, reset } = setup();
    router.apply("#/state/MA");
    expect(zoomState).toHaveBeenCalledExactlyOnceWith("MA");
    expect(openPark).not.toHaveBeenCalled();
    expect(closePark).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("closes the park, without re-zooming, for its own state's route", () => {
    const { router, zoomState, closePark } = setup();
    router.apply("#/park/acad");
    zoomState.mockClear();
    router.apply("#/state/ME");
    expect(closePark).toHaveBeenCalledOnce();
    expect(zoomState).not.toHaveBeenCalled();
  });

  it("resets on an empty hash, only when there is something to reset", () => {
    const { router, reset } = setup();
    router.apply("");
    expect(reset).not.toHaveBeenCalled();
    router.apply("#/state/MA");
    router.apply("");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("is idempotent", () => {
    const { router, openPark, zoomState } = setup();
    router.apply("#/park/yell");
    router.apply("#/park/yell");
    expect(zoomState).toHaveBeenCalledOnce();
    expect(openPark).toHaveBeenCalledOnce();
  });

  it("ignores unknown routes, parks and states silently", () => {
    const { router, openPark, zoomState, closePark, reset } = setup();
    for (const hash of ["#oops", "#/park/zzzz", "#/state/ZZ"]) {
      router.apply(hash);
    }
    expect(openPark).not.toHaveBeenCalled();
    expect(zoomState).not.toHaveBeenCalled();
    expect(closePark).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});

it("opens a park without zooming when none of its states is drawn", () => {
  const { router, openPark, zoomState } = setup();
  router.apply("#/park/nope");
  expect(zoomState).not.toHaveBeenCalled();
  expect(openPark).toHaveBeenCalledWith("nope");
});

describe("router URL writes", () => {
  it("replaces the entry when a state is zoomed or cleared", () => {
    const { router, win } = setup();
    router.stateChanged("MA");
    expect(win.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?x=1#/state/MA",
    );
    router.stateChanged(null);
    expect(win.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?x=1",
    );
    expect(win.history.pushState).not.toHaveBeenCalled();
  });

  it("pushes one entry when the park sheet opens, then replaces", () => {
    const { router, win } = setup();
    router.stateChanged("MT");
    router.parkChanged("yell");
    expect(win.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null,
      "",
      "/?x=1#/park/yell",
    );
    router.parkChanged("acad");
    expect(win.history.pushState).toHaveBeenCalledOnce();
    expect(win.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?x=1#/park/acad",
    );
  });

  it("falls back to the state route when the park sheet closes", () => {
    const { router, win } = setup();
    router.stateChanged("MT");
    router.parkChanged("yell");
    router.parkChanged(null);
    expect(win.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?x=1#/state/MT",
    );
  });

  it("writes nothing while applying a hash or when the hash is current", () => {
    const { router, win, zoomState } = setup();
    // The UI reports back during apply, like the real callbacks do.
    zoomState.mockImplementation((abbr) => router.stateChanged(abbr));
    win.location.hash = "#/state/MA";
    router.apply("#/state/MA");
    expect(win.history.replaceState).not.toHaveBeenCalled();
    expect(win.history.pushState).not.toHaveBeenCalled();
    router.stateChanged("MA");
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it("applies the current hash on start and on later changes", () => {
    const { router, win, zoomState } = setup("#/state/MA");
    router.start();
    expect(zoomState).toHaveBeenCalledWith("MA");
    win.location.hash = "#/state/ME";
    win.listeners.hashchange();
    expect(zoomState).toHaveBeenLastCalledWith("ME");
  });
});
