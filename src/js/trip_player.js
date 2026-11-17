// Trip playback: the route draws itself day by day while the camera follows
// and each stop lights up as the line reaches it.
//
// `planTrip` is pure (tested in node). `createTripPlayer` sequences the plan
// through injected async effects, so it holds no D3 or DOM code either: the
// map side (src/index.js) supplies the camera, leg drawing and stop lighting.

// Legs at most this long (miles) count as walking around one place; a run of
// them gets its own close-up camera move.
const NEARBY_MILES = 3;

/**
 * Great-circle distance between two parks.
 * @param {object} a - Park with `latitude`/`longitude` (numbers or strings)
 * @param {object} b - Park
 * @return {number} Miles
 */
export function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const lat1 = +a.latitude * rad;
  const lat2 = +b.latitude * rad;
  const dLat = lat2 - lat1;
  const dLng = (+b.longitude - +a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Split a trip into playback steps, one per day, each made of camera moves
 * (`focus`: the stops the camera fits; `legs`: the legs drawn there). Leg i
 * joins stop i and stop i+1.
 *
 * - A day starts with the drive from the previous day's last stop: the
 *   camera fits both ends of that leg.
 * - The day's own legs share one move, unless some of them are short
 *   (NEARBY_MILES): then each run of short legs gets a close-up move and the
 *   long legs around it get their own, so a day on the National Mall is not
 *   drawn at road-trip scale.
 * - No move without legs: a first day with one stop leaves the camera alone.
 * @param {object} trip - Built trip (see buildTrips in trips.js)
 * @return {object[]} Steps: `{ date, stops, legs, moves: [{ focus, legs }] }`
 *   where `legs` lists every leg ending on that day
 */
export function planTrip(trip) {
  const stops = trip.stops;
  const steps = [];
  let index = 0;
  for (const day of trip.days) {
    const first = index;
    const last = index + day.stops.length - 1;
    const moves = [];
    if (first > 0)
      moves.push({
        focus: [stops[first - 1], stops[first]],
        legs: [first - 1],
      });

    const dayLegs = [];
    for (let i = first; i < last; i += 1) dayLegs.push(i);
    const short = (i) =>
      milesBetween(stops[i].park, stops[i + 1].park) <= NEARBY_MILES;
    if (dayLegs.length > 0 && dayLegs.some(short) && !dayLegs.every(short)) {
      // Group consecutive legs of the same kind into one move each.
      for (const i of dayLegs) {
        const prev = moves[moves.length - 1];
        if (prev && prev.day && prev.short === short(i)) {
          prev.legs.push(i);
          prev.focus.push(stops[i + 1]);
        } else {
          moves.push({
            day: true,
            short: short(i),
            legs: [i],
            focus: [stops[i], stops[i + 1]],
          });
        }
      }
    } else if (dayLegs.length > 0) {
      moves.push({ focus: day.stops, legs: dayLegs });
    }

    steps.push({
      date: day.date,
      stops: day.stops,
      legs: moves.flatMap((m) => m.legs),
      moves: moves.map(({ focus, legs }) => ({ focus, legs })),
    });
    index = last + 1;
  }
  return steps;
}

/**
 * Durations for each leg, proportional to its drawn length, clamped, and
 * scaled down together so the whole route draws within `budget` ms.
 * @param {number[]} lengths - Leg lengths (any unit, same for all)
 * @param {object} [options]
 * @param {number} [options.min=250] - Shortest leg, ms
 * @param {number} [options.max=1200] - Longest leg, ms
 * @param {number} [options.budget=9000] - Total for all legs, ms
 * @return {number[]} Milliseconds per leg
 */
export function legDurations(
  lengths,
  { min = 250, max = 1200, budget = 9000 } = {},
) {
  const longest = Math.max(0, ...lengths);
  const raw = lengths.map((len) =>
    longest > 0 ? Math.max(min, (len / longest) * max) : min,
  );
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = total > budget ? budget / total : 1;
  return raw.map((ms) => Math.round(ms * scale));
}

/**
 * Create a player. One trip plays at a time; `play` cancels a running one.
 * @param {object} effects
 * @param {(stops: object[]) => Promise<void>} effects.camera - Move the
 *   camera to fit stops; the promise rejects when interrupted
 * @param {(index: number, ms: number) => Promise<void>} effects.drawLeg -
 *   Draw a hidden leg; rejects when interrupted
 * @param {(index: number) => number} effects.legLength - Drawn leg length
 * @param {(stop: object) => void} effects.lightStop - The line reached a stop
 * @param {(step: object) => void} [effects.onDay] - A day begins
 * @param {(trip: object, options: {fit: boolean}) => void} effects.finish -
 *   Show the end state (every leg drawn, every stop lit); `fit` asks to zoom
 *   out to the whole trip
 * @param {(running: boolean) => void} [effects.onState] - Playing or not
 * @return {object} `{ play, skip, stop, isPlaying }`
 */
export function createTripPlayer({
  camera,
  drawLeg,
  legLength,
  lightStop,
  onDay = () => {},
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
    setPlaying(trip);
    const steps = planTrip(trip);
    const durations = legDurations(
      trip.stops.slice(1).map((_, i) => legLength(i)),
    );
    try {
      lightStop(trip.stops[0]);
      for (const step of steps) {
        if (mine !== token) return false;
        onDay(step);
        for (const move of step.moves) {
          if (mine !== token) return false;
          await camera(move.focus);
          for (const leg of move.legs) {
            if (mine !== token) return false;
            await drawLeg(leg, durations[leg]);
            if (mine !== token) return false;
            lightStop(trip.stops[leg + 1]);
          }
        }
      }
    } catch {
      // A transition was interrupted. By skip/stop (stale token): they own
      // the end state. By anything else (a press on the map interrupts the
      // camera): end here, leaving the camera where it is.
      if (mine === token) {
        token += 1;
        setPlaying(null);
        finish(trip, { fit: false });
      }
      return false;
    }
    if (mine !== token) return false;
    finish(trip, { fit: true });
    setPlaying(null);
    return true;
  }

  /**
   * Jump to the end state.
   * @param {object} [options]
   * @param {boolean} [options.fit=true] - Zoom out to the whole trip (false
   *   when the user is moving the map)
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
