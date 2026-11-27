/**
 * Parsing for timer data from the storefront API (and from the local cache,
 * which stores the same shape). Anything malformed is dropped rather than
 * rendered, so a bad payload can't break the product page.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SIZES = new Set(["small", "medium", "large"]);
const URGENCY_EFFECTS = new Set(["color_pulse", "shake", "none"]);
/** Evergreen durations the admin allows: 1 minute to 365 days. Keep in step with the server. */
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 365 * 24 * 60;

const MIN_REFRESH_SECONDS = 15;
const MAX_REFRESH_SECONDS = 3_600;
export const DEFAULT_REFRESH_SECONDS = 60;

/**
 * A timer as the storefront API sends it (and as the feed caches it). Timer
 * kinds this build of the widget doesn't know are skipped.
 *
 * - `countdown`: runs from `startsAt` to `endsAt` for every shopper.
 * - `evergreen`: runs for `durationMinutes` from this shopper's first visit;
 *   `core/evergreen.js` works out when that is.
 *
 * `priority` is how specifically the timer targets the product (higher wins).
 *
 * @typedef {{
 *   id: string,
 *   message: string,
 *   color: string,
 *   size: "small" | "medium" | "large",
 *   urgency: "color_pulse" | "shake" | "none",
 *   priority: number,
 * } & (
 *   { type: "countdown", startsAt: number, endsAt: number } |
 *   { type: "evergreen", durationMinutes: number }
 * )} FeedTimer
 */

/**
 * A timer with its start and end known, ready to show. Evergreen timers carry
 * this shopper's start and end.
 *
 * @typedef {FeedTimer & { startsAt: number, endsAt: number }} Timer
 */

function toEpoch(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/** The when-it-runs part of a timer, or null if it's malformed or of an unknown type. */
function parsePeriod(raw) {
  if (raw.type === "countdown") {
    const startsAt = toEpoch(raw.startsAt);
    const endsAt = toEpoch(raw.endsAt);
    if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) return null;
    return { type: "countdown", startsAt, endsAt };
  }
  if (raw.type === "evergreen") {
    const minutes = raw.durationMinutes;
    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_DURATION_MINUTES ||
      minutes > MAX_DURATION_MINUTES
    ) {
      return null;
    }
    return { type: "evergreen", durationMinutes: minutes };
  }
  return null;
}

/** @returns {FeedTimer | null} */
export function parseTimer(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  const period = parsePeriod(raw);
  if (!period) return null;

  return {
    id: raw.id,
    ...period,
    message: typeof raw.message === "string" ? raw.message : "",
    color: HEX_COLOR.test(raw.color) ? raw.color : "#008060",
    size: SIZES.has(raw.size) ? raw.size : "medium",
    urgency: URGENCY_EFFECTS.has(raw.urgency) ? raw.urgency : "none",
    priority: Number.isInteger(raw.priority) && raw.priority >= 0 ? raw.priority : 0,
  };
}

/**
 * Parses a storefront API response.
 * @returns {{ timers: FeedTimer[], serverTime: number, refreshInterval: number } | null}
 */
export function parseTimersResponse(body) {
  if (!body || !Array.isArray(body.timers)) return null;
  const refresh = Number(body.refreshInterval);
  return {
    timers: body.timers.map(parseTimer).filter(Boolean),
    serverTime: toEpoch(body.serverTime),
    refreshInterval: Number.isFinite(refresh)
      ? Math.min(Math.max(refresh, MIN_REFRESH_SECONDS), MAX_REFRESH_SECONDS)
      : DEFAULT_REFRESH_SECONDS,
  };
}

/**
 * Puts timers in the order they take the block: most specific targeting first,
 * then the one ending soonest. The API sends them in this order already, but
 * only the browser knows when its evergreen timers end. The sort is stable, so
 * the API's order breaks ties.
 *
 * @param {Timer[]} timers
 * @returns {Timer[]}
 */
export function orderTimers(timers) {
  return timers
    .map((timer, index) => ({ timer, index }))
    .sort(
      (a, b) =>
        b.timer.priority - a.timer.priority || a.timer.endsAt - b.timer.endsAt || a.index - b.index,
    )
    .map(({ timer }) => timer);
}

/**
 * The timer to show at `now`: the first running one, from timers in the order
 * `orderTimers` puts them.
 *
 * @param {Timer[]} timers
 * @param {number} now
 */
export function runningTimer(timers, now) {
  return timers.find((timer) => timer.startsAt <= now && now < timer.endsAt) ?? null;
}

/** Splits milliseconds into whole days, hours, minutes and seconds. */
export function splitDuration(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

/** Black or white text, whichever contrasts more with `hex` (WCAG relative luminance). */
export function readableTextColor(hex) {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#1a1a1a";
}
