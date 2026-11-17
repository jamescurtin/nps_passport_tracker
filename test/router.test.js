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

  it("parses and formats trip routes", () => {
    expect(parseHash("#/trip/2023-05-California")).toEqual({
      type: "trip",
      id: "2023-05-california",
    });
    expect(parseHash("#/trip/")).toBeNull();
    expect(formatHash({ trip: "2022-11-nyc" })).toBe("#/trip/2022-11-nyc");
    // A park sheet over a trip wins; a trip wins over a state.
    expect(formatHash({ park: "stli", trip: "2022-11-nyc" })).toBe(
      "#/park/stli",
    );
    expect(formatHash({ trip: "2022-11-nyc", state: "NY" })).toBe(
      "#/trip/2022-11-nyc",
    );
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
    openTrip: vi.fn(),
    closeTrip: vi.fn(),
    openTimeline: vi.fn(),
    closeTimeline: vi.fn(),
  };
  const router = createRouter({
    win,
    parkStates: (code) => parks[code] ?? null,
    hasState: (abbr) => ["WY", "MT", "ID", "ME", "MA"].includes(abbr),
    hasTrip: (id) => ["2023-05-california", "2022-11-nyc"].includes(id),
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

describe("router trips", () => {
  it("opens a known trip and ignores an unknown one", () => {
    const { router, openTrip } = setup();
    router.apply("#/trip/nope");
    expect(openTrip).not.toHaveBeenCalled();
    router.apply("#/trip/2023-05-california");
    expect(openTrip).toHaveBeenCalledExactlyOnceWith("2023-05-california");
    router.apply("#/trip/2023-05-california");
    expect(openTrip).toHaveBeenCalledOnce();
  });

  it("opens a park over a trip without zooming to its state", () => {
    const { router, zoomState, openPark, closePark } = setup();
    router.apply("#/trip/2022-11-nyc");
    router.apply("#/park/acad");
    expect(zoomState).not.toHaveBeenCalled();
    expect(openPark).toHaveBeenCalledWith("acad");
    // Back to the trip closes the park and keeps the trip.
    router.apply("#/trip/2022-11-nyc");
    expect(closePark).toHaveBeenCalledOnce();
  });

  it("leaves the trip for a state route and resets from a trip", () => {
    const { router, closeTrip, zoomState, reset } = setup();
    router.apply("#/trip/2022-11-nyc");
    router.apply("#/state/MA");
    expect(closeTrip).toHaveBeenCalledOnce();
    expect(zoomState).toHaveBeenCalledWith("MA");
    router.apply("#/trip/2022-11-nyc");
    router.apply("");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("pushes when a trip opens and replaces when it swaps or closes", () => {
    const { router, win } = setup();
    router.tripChanged("2022-11-nyc");
    expect(win.history.pushState).toHaveBeenCalledOnce();
    expect(win.location.hash).toBe("#/trip/2022-11-nyc");
    router.tripChanged("2023-05-california");
    router.tripChanged(null);
    expect(win.history.pushState).toHaveBeenCalledOnce();
    expect(win.history.replaceState).toHaveBeenCalledTimes(2);
    expect(win.location.hash).toBe("");
  });

  it("a trip replaces the zoomed state in the URL", () => {
    const { router, win } = setup();
    router.stateChanged("MA");
    router.tripChanged("2022-11-nyc");
    expect(win.location.hash).toBe("#/trip/2022-11-nyc");
    router.tripChanged(null);
    expect(win.location.hash).toBe("");
  });
});

describe("router timeline", () => {
  it("parses and formats #/timeline", () => {
    expect(parseHash("#/timeline")).toEqual({ type: "timeline" });
    expect(formatHash({ timeline: true })).toBe("#/timeline");
    expect(formatHash({ timeline: true, state: "MA" })).toBe("#/timeline");
    expect(formatHash({ park: "acad", timeline: true })).toBe("#/park/acad");
  });

  it("opens the timeline once and closes the trip first", () => {
    const { router, openTimeline, closeTrip } = setup();
    router.apply("#/trip/2022-11-nyc");
    router.apply("#/timeline");
    router.apply("#/timeline");
    expect(closeTrip).toHaveBeenCalledOnce();
    expect(openTimeline).toHaveBeenCalledOnce();
  });

  it("a park opens over the timeline without zooming", () => {
    const { router, zoomState, openPark } = setup();
    router.apply("#/timeline");
    router.apply("#/park/acad");
    expect(zoomState).not.toHaveBeenCalled();
    expect(openPark).toHaveBeenCalledWith("acad");
  });

  it("a trip or state route closes the timeline; reset resets", () => {
    const { router, closeTimeline, reset } = setup();
    router.apply("#/timeline");
    router.apply("#/trip/2022-11-nyc");
    expect(closeTimeline).toHaveBeenCalledOnce();
    router.apply("#/timeline");
    router.apply("#/state/MA");
    expect(closeTimeline).toHaveBeenCalledTimes(2);
    router.apply("#/timeline");
    router.apply("");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("pushes on open and replaces on close", () => {
    const { router, win } = setup();
    router.timelineChanged(true);
    expect(win.history.pushState).toHaveBeenCalledOnce();
    expect(win.location.hash).toBe("#/timeline");
    router.timelineChanged(false);
    expect(win.location.hash).toBe("");
  });
});
