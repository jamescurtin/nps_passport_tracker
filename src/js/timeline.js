// Timeline model: every park visit on one time axis, from the first visit to
// today. Pure functions plus a small playback sequencer; no DOM or D3, so
// tests import this in node. The sheet lives in timeline_ui.js and the map
// side in src/index.js.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} iso - `YYYY-MM-DD`
 * @return {number} Days since 1970-01-01 (UTC, no time zone shift)
 */
export function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * @param {number} day - Days since 1970-01-01
 * @return {string} `YYYY-MM-DD`
 */
export function isoFromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {Date} [now] - Defaults to the current time
 * @return {string} Local calendar date as `YYYY-MM-DD`
 */
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Index of the first element of sorted `list` that is greater than `value`.
 * @param {string[]} list - Sorted ascending
 * @param {string} value - Probe
 * @return {number} Count of elements <= value
 */
function countAtOrBefore(list, value) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Build the timeline from the merged park data.
 * @param {object[]} parks - Parks; visited ones carry `visitedOn` dates
 * @param {object} [options]
 * @param {string} [options.today] - End of the axis, `YYYY-MM-DD`
 * @return {object} `{ start, end, events, firstVisit, years, countAt,
 *   visitsInYearAt }`. `events` is one entry per visit date, oldest first:
 *   `{ date, parks, newParks }` (`newParks`: first visits that day).
 */
export function buildTimeline(parks, { today = todayIso() } = {}) {
  const byDate = new Map();
  const firstVisit = new Map();
  for (const park of parks) {
    if (!park.visited || !park.visitedOn) continue;
    const dates = [...park.visitedOn].sort();
    firstVisit.set(park.parkCode, dates[0]);
    for (const date of dates) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(park);
    }
  }
  const events = [...byDate.keys()].sort().map((date) => {
    const visited = byDate.get(date);
    return {
      date,
      parks: visited,
      newParks: visited.filter((p) => firstVisit.get(p.parkCode) === date),
    };
  });
  const start = events.length ? events[0].date : today;
  const last = events.length ? events[events.length - 1].date : today;
  const end = today > last ? today : last;

  const firstDates = [...firstVisit.values()].sort();
  const visitDates = events.flatMap((e) => e.parks.map(() => e.date));

  const years = [];
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y += 1) {
    const prefix = String(y);
    years.push({
      year: y,
      visits: visitDates.filter((d) => d.startsWith(prefix)).length,
    });
  }

  return {
    start,
    end,
    events,
    firstVisit,
    years,
    /**
     * @param {string} date - `YYYY-MM-DD`
     * @return {number} Distinct parks first visited on or before `date`
     */
    countAt: (date) => countAtOrBefore(firstDates, date),
    /**
     * @param {number} year - Calendar year
     * @param {string} date - `YYYY-MM-DD`
     * @return {number} Park visits in `year` on or before `date`
     */
    visitsInYearAt: (year, date) => {
      const from = `${year}-01-01`;
      const to = date < `${year}-12-31` ? date : `${year}-12-31`;
      if (to < from) return 0;
      return (
        countAtOrBefore(visitDates, to) -
        countAtOrBefore(visitDates, `${year - 1}-12-31`)
      );
    },
  };
}

/**
 * Events still to play after `date`. At or past the last event, playback
 * starts over from the first.
 * @param {object} timeline - From buildTimeline
 * @param {string} date - Current position, `YYYY-MM-DD`
 * @return {{events: object[], restart: boolean}} What to play; `restart`
 *   means the position must first go back to before the first visit
 */
export function eventsAfter(timeline, date) {
  const rest = timeline.events.filter((e) => e.date > date);
  if (rest.length) return { events: rest, restart: false };
  return { events: timeline.events, restart: true };
}

/**
 * Sequence timeline playback through an injected async `step`. One run at a
 * time; `play` cancels a running one.
 * @param {object} options
 * @param {(event: object, cancelled: () => boolean) => Promise<void>}
 *   options.step - Show one event (move the date, the camera, wait); may
 *   reject when a transition is interrupted
 * @param {(playing: boolean) => void} [options.onState] - Playing or not
 * @return {object} `{ play, stop, isPlaying }`
 */
export function createTimelinePlayer({ step, onState = () => {} }) {
  let token = 0;
  let playing = false;

  function set(value) {
    if (playing === value) return;
    playing = value;
    onState(value);
  }

  /**
   * @param {object[]} events - Events to play, in order
   * @return {Promise<boolean>} true if it reached the end
   */
  async function play(events) {
    const mine = ++token;
    set(true);
    const cancelled = () => mine !== token;
    try {
      for (const event of events) {
        if (cancelled()) return false;
        await step(event, cancelled);
      }
    } catch {
      // Interrupted by something outside (a press on the map): pause here.
      if (!cancelled()) {
        token += 1;
        set(false);
      }
      return false;
    }
    if (cancelled()) return false;
    set(false);
    return true;
  }

  /**
   * Pause: the position stays where it is.
   */
  function stop() {
    token += 1;
    set(false);
  }

  return { play, stop, isPlaying: () => playing };
}
