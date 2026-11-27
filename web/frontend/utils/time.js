/**
 * Date and time helpers. Timers are scheduled in the shop's time zone, so all
 * wall-clock values here are plain strings ("YYYY-MM-DD", "HH:MM") rather than
 * `Date` objects, which would silently apply the browser's time zone.
 */

const TIME_PATTERN = /^(\d{1,2})(?:[:.h\s]?(\d{2}))?\s*(a|p)?\.?\s*m?\.?$/i;

/**
 * Parses flexible time input into 24-hour "HH:MM".
 * Accepts "9", "9:30", "0930", "9.30", "9:30pm", "9:30 p.m.", "21:30", "12am".
 *
 * @param {string} input
 * @returns {string | null} "HH:MM", "" for blank input, or null if invalid
 */
export function parseTimeInput(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";

  const match = TIME_PATTERN.exec(text);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "a" && hours === 12) hours = 0;
    if (meridiem === "p" && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Formats "HH:MM" for display in the merchant's locale, e.g. "9:30 PM" or "21:30".
 * @param {string} time
 * @param {string} locale
 */
export function formatTimeOfDay(time, locale) {
  const parsed = parseTimeInput(time);
  if (!parsed) return time ?? "";
  const [hours, minutes] = parsed.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

/**
 * Returns the current wall-clock date and time in `timeZone`.
 * @returns {{ date: string, time: string }}
 */
export function nowInTimeZone(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Offset of `timeZone` from UTC at `epochMs`, in milliseconds. */
function timeZoneOffset(epochMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(new Date(epochMs))
      .map(({ type, value }) => [type, Number(value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Converts a wall-clock date and "HH:MM" time in `timeZone` to a UTC timestamp.
 * Used for previews only; the server does the authoritative conversion.
 *
 * @returns {number | null}
 */
export function zonedWallTimeToEpoch(date, time, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  const parsedTime = parseTimeInput(time);
  if (!dateMatch || !parsedTime) return null;

  const [hours, minutes] = parsedTime.split(":").map(Number);
  const guess = Date.UTC(+dateMatch[1], +dateMatch[2] - 1, +dateMatch[3], hours, minutes);
  if (Number.isNaN(guess)) return null;
  try {
    const first = guess - timeZoneOffset(guess, timeZone);
    // Re-check at the result in case it crosses a DST transition.
    return guess - timeZoneOffset(first, timeZone);
  } catch {
    return null;
  }
}

/**
 * Formats a UTC ISO instant in the timer's time zone, e.g. "Nov 29, 2026, 12:00 AM".
 */
export function formatInstant(iso, { locale, timeZone }) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** Returns a short, readable time zone label, e.g. "Eastern Standard Time". */
export function describeTimeZone(timeZone, locale, now = new Date()) {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "long" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return name ? `${name} (${timeZone})` : timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Splits a duration into whole days, hours, minutes and seconds.
 * @param {number} milliseconds
 */
export function splitDuration(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}
