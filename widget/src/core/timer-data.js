/**
 * Parsing for timer data from the storefront API (and from the local cache,
 * which stores the same shape). Anything malformed is dropped rather than
 * rendered, so a bad payload can't break the product page.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SIZES = new Set(["small", "medium", "large"]);
const URGENCY_EFFECTS = new Set(["color_pulse", "shake", "none"]);
/** Timer kinds this build of the widget can render. Others are skipped. */
const SUPPORTED_TYPES = new Set(["countdown"]);

const MIN_REFRESH_SECONDS = 15;
const MAX_REFRESH_SECONDS = 3_600;
export const DEFAULT_REFRESH_SECONDS = 60;

/**
 * @typedef {{
 *   id: string,
 *   type: "countdown",
 *   startsAt: number,
 *   endsAt: number,
 *   message: string,
 *   color: string,
 *   size: "small" | "medium" | "large",
 *   urgency: "color_pulse" | "shake" | "none",
 * }} Timer
 */

function toEpoch(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/** @returns {Timer | null} */
export function parseTimer(raw) {
  if (!raw || typeof raw !== "object") return null;
  const startsAt = toEpoch(raw.startsAt);
  const endsAt = toEpoch(raw.endsAt);
  if (
    typeof raw.id !== "string" ||
    !SUPPORTED_TYPES.has(raw.type) ||
    Number.isNaN(startsAt) ||
    Number.isNaN(endsAt) ||
    endsAt <= startsAt
  ) {
    return null;
  }

  return {
    id: raw.id,
    type: raw.type,
    startsAt,
    endsAt,
    message: typeof raw.message === "string" ? raw.message : "",
    color: HEX_COLOR.test(raw.color) ? raw.color : "#008060",
    size: SIZES.has(raw.size) ? raw.size : "medium",
    urgency: URGENCY_EFFECTS.has(raw.urgency) ? raw.urgency : "none",
  };
}

/**
 * Parses a storefront API response.
 * @returns {{ timers: Timer[], serverTime: number, refreshInterval: number } | null}
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
 * The timer to show at `now`: the first running one. The API sends timers in
 * priority order (most specific targeting first, then soonest to end).
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
