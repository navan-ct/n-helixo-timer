import { DateTime, IANAZone } from "luxon";

import { ValidationError } from "../lib/errors.js";

export const FALLBACK_TIME_ZONE = "UTC";

export function isValidTimeZone(zone) {
  return typeof zone === "string" && IANAZone.isValidZone(zone);
}

/**
 * Converts a wall-clock date and time in `zone` to a UTC `Date`.
 * Times that fall into a daylight-saving gap are shifted forward by the gap,
 * matching how Shopify treats nonexistent local times.
 *
 * @param {string} date YYYY-MM-DD
 * @param {string} time HH:MM (24-hour)
 * @param {string} zone IANA time zone, e.g. "America/New_York"
 * @returns {Date | null} null when the inputs don't form a valid date
 */
export function zonedWallTimeToUtc(date, time, zone) {
  const dateTime = DateTime.fromISO(`${date}T${time}`, { zone });
  return dateTime.isValid ? dateTime.toUTC().toJSDate() : null;
}

/**
 * Splits a UTC instant into wall-clock date and time strings in `zone`.
 * @returns {{ date: string, time: string }}
 */
export function utcToZonedParts(instant, zone) {
  const dateTime = DateTime.fromJSDate(instant, { zone });
  return { date: dateTime.toFormat("yyyy-LL-dd"), time: dateTime.toFormat("HH:mm") };
}

/**
 * Resolves the wall-clock schedule from validated input into UTC instants and
 * enforces ordering rules.
 *
 * - A blank start means "start immediately" (`now`).
 * - The end must be after the start.
 * - The end must be in the future, unless an existing timer's end is unchanged
 *   (so merchants can still rename an expired timer).
 *
 * @param {{ startDate: string | null, startTime: string | null, endDate: string, endTime: string }} input
 * @param {{ zone: string, now: Date, previousEndsAt?: Date }} context
 * @returns {{ startsAt: Date, endsAt: Date }}
 */
export function resolveSchedule(input, { zone, now, previousEndsAt }) {
  const { startDate, startTime, endDate, endTime } = input;
  const errors = {};

  const startsAt = startDate ? zonedWallTimeToUtc(startDate, startTime, zone) : now;
  const endsAt = zonedWallTimeToUtc(endDate, endTime, zone);

  if (!startsAt) errors.startDate = "Enter a valid start date and time.";
  if (!endsAt) errors.endDate = "Enter a valid end date and time.";
  if (Object.keys(errors).length) throw new ValidationError(errors);

  // Point the error at the time field when both ends fall on the same day.
  const startDay = startDate ?? utcToZonedParts(startsAt, zone).date;
  const endField = startDay === endDate ? "endTime" : "endDate";

  if (endsAt <= startsAt) {
    throw new ValidationError({
      [endField]: startDate ? "End must be after the start." : "End must be in the future.",
    });
  }

  const endChanged = !previousEndsAt || previousEndsAt.getTime() !== endsAt.getTime();
  if (endChanged && endsAt <= now) {
    throw new ValidationError({ [endField]: "End must be in the future." });
  }

  return { startsAt, endsAt };
}
