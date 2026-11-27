import { readJson, writeJson } from "./storage.js";

/**
 * Evergreen timers run separately for each shopper: a timer starts the first
 * time this browser receives it (the shopper's first visit to a product it
 * applies to) and ends `durationMinutes` later. Starts are kept in
 * localStorage, one entry per shop, so they survive reloads, new tabs and later
 * visits; once a shopper's timer has run out it stays ended for them.
 *
 * When storage is blocked, starts are kept in memory for the page instead, so
 * the timer still counts down but starts over on the next page view. In the
 * theme editor they're never stored, so merchants previewing their store don't
 * use up their own timer.
 */

const KEY_PREFIX = "helixo-timer:evergreen:";
const VERSION = 1;
/** Most starts remembered per shop; the oldest are forgotten first. */
export const MAX_REMEMBERED_STARTS = 100;
const MINUTE_MS = 60_000;

/** shop -> Map(timer ID -> start), for this page. */
const memory = new Map();

const storageKey = (shop) => `${KEY_PREFIX}${shop}`;

function readStoredStarts(shop) {
  const entry = readJson(storageKey(shop));
  const starts = new Map();
  if (entry?.v !== VERSION || !entry.starts || typeof entry.starts !== "object") return starts;
  for (const [id, startedAt] of Object.entries(entry.starts)) {
    if (Number.isFinite(startedAt)) starts.set(id, startedAt);
  }
  return starts;
}

/**
 * Keeps the starts of the timers in `current`, then the most recent others, and
 * saves them when `persist` is set.
 */
function remember(shop, starts, current, persist) {
  const kept = [...starts]
    .sort((a, b) => Number(current.has(b[0])) - Number(current.has(a[0])) || b[1] - a[1])
    .slice(0, MAX_REMEMBERED_STARTS);
  memory.set(shop, new Map(kept));
  if (persist) writeJson(storageKey(shop), { v: VERSION, starts: Object.fromEntries(kept) });
}

/**
 * Gives every evergreen timer this shopper's start and end, starting the ones
 * this browser hasn't seen yet at `now`. Countdowns pass through unchanged.
 *
 * @param {import("./timer-data.js").FeedTimer[]} timers
 * @param {{ shop: string, now: number, persist: boolean }} options `now` is
 *   the server-corrected time, so starts and ends line up with the server.
 * @returns {import("./timer-data.js").Timer[]}
 */
export function resolveEvergreenTimers(timers, { shop, now, persist }) {
  if (!timers.some((timer) => timer.type === "evergreen")) return timers;

  const starts = new Map(memory.get(shop));
  if (persist) {
    // Another tab may have started a timer meanwhile: the earliest start wins.
    for (const [id, startedAt] of readStoredStarts(shop)) {
      starts.set(id, Math.min(startedAt, starts.get(id) ?? Infinity));
    }
  }

  let started = false;
  for (const timer of timers) {
    if (timer.type === "evergreen" && !starts.has(timer.id)) {
      starts.set(timer.id, now);
      started = true;
    }
  }
  if (started) remember(shop, starts, new Set(timers.map((timer) => timer.id)), persist);
  else memory.set(shop, starts);

  return timers.map((timer) => {
    if (timer.type !== "evergreen") return timer;
    // A start "in the future" means the device clock moved back; count from now.
    const startsAt = Math.min(starts.get(timer.id), now);
    return { ...timer, startsAt, endsAt: startsAt + timer.durationMinutes * MINUTE_MS };
  });
}

/** Test helper: forget the starts kept in memory. */
export function resetEvergreen() {
  memory.clear();
}
