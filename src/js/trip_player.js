// Trip playback: the route draws itself at a steady pace over a faint copy
// of the whole route, and each stop lights up as the line reaches it.
//
// The camera stays on an overview of the trip. It zooms in only for a run of
// stops so close together that their dots would overlap at the overview
// zoom (a day on the National Mall, a day in Manhattan), then zooms back out.
//
// `planRuns` and `runDurations` are pure (tested in node). `createTripPlayer`
// sequences them through injected async effects, so it holds no D3 or DOM
// code either: the map side (src/index.js) measures legs on screen, moves
// the camera, draws runs and lights stops.

/**
 * Split a trip's legs into runs drawn without a camera move. A close-up run
 * is a stretch of at least `minLegs` consecutive legs each shorter than
 * `threshold` px on screen at the overview zoom.
 * @param {number[]} screenLengths - Each leg's length on screen at the
 *   overview zoom, px (leg i joins stop i and stop i+1)
 * @param {object} [options]
 * @param {number} [options.threshold=14] - Shorter legs count as crowded
 * @param {number} [options.minLegs=2] - Shortest close-up run; one short leg
 *   alone is not worth two camera moves. A trip whose legs are all short is
 *   one close-up, however many legs it has.
 * @return {{legs: number[], closeUp: boolean}[]} Runs in order, covering
 *   every leg once
 */
export function planRuns(screenLengths, { threshold = 14, minLegs = 2 } = {}) {
  // A trip that never leaves one city is a close-up from start to finish,
  // even with a single leg.
  if (screenLengths.length && screenLengths.every((len) => len < threshold)) {
    return [{ legs: screenLengths.map((_, i) => i), closeUp: true }];
  }
  // First pass: maximal stretches of short and long legs.
  const stretches = [];
  screenLengths.forEach((len, i) => {
    const short = len < threshold;
    const last = stretches[stretches.length - 1];
    if (last && last.short === short) last.legs.push(i);
    else stretches.push({ short, legs: [i] });
  });
  // Second pass: short stretches that are long enough become close-ups;
  // the rest merge with their overview neighbours.
  const runs = [];
  for (const { short, legs } of stretches) {
    const closeUp = short && legs.length >= minLegs;
    const last = runs[runs.length - 1];
    if (last && !last.closeUp && !closeUp) last.legs.push(...legs);
    else runs.push({ legs: [...legs], closeUp });
  }
  return runs;
}

/**
 * Milliseconds to draw each run at a steady on-screen speed, with a floor,
 * scaled down together to fit the budget.
 * @param {number[]} lengths - Each run's drawn length on screen, px
 * @param {object} [options]
 * @param {number} [options.speed=0.4] - px per ms
 * @param {number} [options.min=500] - Shortest run, ms
 * @param {number} [options.budget=10000] - All runs together, ms
 * @return {number[]} Milliseconds per run
 */
export function runDurations(
  lengths,
  { speed = 0.4, min = 500, budget = 10000 } = {},
) {
  const raw = lengths.map((len) => Math.max(min, len / speed));
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = total > budget ? budget / total : 1;
  return raw.map((ms) => Math.round(ms * scale));
}

/**
 * Create a player. One trip plays at a time; `play` cancels a running one.
 * @param {object} effects
 * @param {(trip: object) => object[]} effects.plan - Runs for a trip (see
 *   planRuns)
 * @param {(trip: object, run: object) => number} effects.runLength - A
 *   run's length on screen at the zoom it is drawn at, px
 * @param {(trip: object, run: object|null) => Promise<void>} effects.camera
 *   - Frame a close-up run, or the overview for null; rejects when
 *   interrupted
 * @param {(run: object, ms: number, onReach: (leg: number) => void) =>
 *   Promise<void>} effects.drawRun - Draw a run's legs in one continuous
 *   stroke, calling onReach as each leg ends; rejects when interrupted
 * @param {(stop: object) => void} effects.lightStop - The line reached a stop
 * @param {(trip: object, options: {fit: boolean}) => void} effects.finish -
 *   Show the end state (every leg drawn, every stop lit); `fit` asks for the
 *   overview
 * @param {(running: boolean) => void} [effects.onState] - Playing or not
 * @return {object} `{ play, skip, stop, isPlaying }`
 */
export function createTripPlayer({
  plan,
  runLength,
  camera,
  drawRun,
  lightStop,
  finish,
  onState = () => {},
}) {
  // Bumped on every play/skip/stop; a run whose token is stale has been
  // cancelled and must not touch the map again.
  let token = 0;
  let current = null;

  function setPlaying(trip) {
    current = trip;
    onState(trip !== null);
  }

  /**
   * Play a trip from its first stop.
   * @param {object} trip - Built trip
   * @return {Promise<boolean>} true if it played to the end
   */
  async function play(trip) {
    const mine = ++token;
    const cancelled = () => mine !== token;
    setPlaying(trip);
    const runs = plan(trip);
    const durations = runDurations(runs.map((run) => runLength(trip, run)));
    try {
      lightStop(trip.stops[0]);
      await camera(trip, null);
      for (const [i, run] of runs.entries()) {
        if (cancelled()) return false;
        if (run.closeUp) await camera(trip, run);
        if (cancelled()) return false;
        await drawRun(run, durations[i], (leg) => {
          if (!cancelled()) lightStop(trip.stops[leg + 1]);
        });
        if (cancelled()) return false;
        if (run.closeUp && i < runs.length - 1) await camera(trip, null);
      }
    } catch {
      // A transition was interrupted. By skip/stop (stale token): they own
      // the end state. By anything else (a press on the map interrupts the
      // camera): end here, leaving the camera where it is.
      if (!cancelled()) {
        token += 1;
        setPlaying(null);
        finish(trip, { fit: false });
      }
      return false;
    }
    if (cancelled()) return false;
    finish(trip, { fit: true });
    setPlaying(null);
    return true;
  }

  /**
   * Jump to the end state.
   * @param {object} [options]
   * @param {boolean} [options.fit=true] - Show the overview (false when the
   *   user is moving the map)
   */
  function skip({ fit = true } = {}) {
    if (!current) return;
    const trip = current;
    token += 1;
    setPlaying(null);
    finish(trip, { fit });
  }

  /**
   * Cancel without touching the map (the trip is being removed).
   */
  function stop() {
    token += 1;
    if (current) setPlaying(null);
  }

  return { play, skip, stop, isPlaying: () => current !== null };
}
