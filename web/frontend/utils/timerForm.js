import { formatTimeOfDay, nowInTimeZone, parseTimeInput, splitMinutes } from "./time";

/** Mirrors web/timers/timer.constants.js. The server remains authoritative. */
export const TIMER_LIMITS = Object.freeze({
  NAME_MAX_LENGTH: 80,
  DESCRIPTION_MAX_LENGTH: 500,
  MAX_TARGET_RESOURCES: 100,
  DURATION_MIN_MINUTES: 1,
  DURATION_MAX_MINUTES: 365 * 24 * 60,
});

/** The longest evergreen duration, in days, for messages. */
export const DURATION_MAX_DAYS = TIMER_LIMITS.DURATION_MAX_MINUTES / (24 * 60);

/**
 * - `countdown`: one schedule for every shopper, from a start to an end.
 * - `evergreen`: a duration that starts on each shopper's first visit.
 */
export const TIMER_TYPES = ["countdown", "evergreen"];

/** The evergreen duration's form fields, largest unit first, with minutes per unit. */
export const DURATION_FIELDS = [
  { field: "durationDays", unit: "days", minutes: 24 * 60 },
  { field: "durationHours", unit: "hours", minutes: 60 },
  { field: "durationMinutes", unit: "minutes", minutes: 1 },
];

const WHOLE_NUMBER = /^\d+$/;

/**
 * Reads one duration field. Blank counts as zero, so merchants only fill the
 * units they need.
 * @returns {number | null} null when it isn't a whole number
 */
export function parseDurationPart(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return WHOLE_NUMBER.test(text) ? Number(text) : null;
}

/**
 * The evergreen duration in minutes. Units may overflow (90 minutes is 1 hour
 * 30 minutes).
 * @returns {number | null} null when a field isn't a whole number
 */
export function durationFromForm(form) {
  let total = 0;
  for (const { field, minutes } of DURATION_FIELDS) {
    const value = parseDurationPart(form[field]);
    if (value === null) return null;
    total += value * minutes;
  }
  return total;
}

/** Whether the form's evergreen duration is one the server accepts. */
export function isValidDuration(minutes) {
  return (
    Number.isInteger(minutes) &&
    minutes >= TIMER_LIMITS.DURATION_MIN_MINUTES &&
    minutes <= TIMER_LIMITS.DURATION_MAX_MINUTES
  );
}

export const TIMER_SIZES = ["small", "medium", "large"];
export const URGENCY_EFFECTS = ["color_pulse", "shake", "none"];
export const TARGET_TYPES = ["all", "products", "collections"];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** @typedef {{ id: string, title: string, handle?: string, imageUrl?: string | null, imageAlt?: string }} TargetResource */

/**
 * Form state for either type of timer; each type uses its own period fields.
 * Times and durations hold the text the merchant typed (e.g. "9:30 PM", "12")
 * and are parsed on validation and submit.
 *
 * @param {"countdown" | "evergreen"} [type]
 */
export function createEmptyForm(type = "countdown") {
  return {
    type,
    name: "",
    description: "",
    // Countdown
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    // Evergreen
    durationDays: "",
    durationHours: "",
    durationMinutes: "",
    color: "#008060",
    size: "medium",
    urgency: "color_pulse",
    targetType: "all",
    /** @type {TargetResource[]} */
    resources: [],
  };
}

/** Duration form fields for a number of minutes, e.g. 90 → 0 days, 1 hour, 30 minutes. */
function durationFields(totalMinutes) {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  return {
    durationDays: String(days),
    durationHours: String(hours),
    durationMinutes: String(minutes),
  };
}

/** Builds form state from a timer returned by the API. */
export function formFromTimer(timer, locale) {
  const type = timer.type ?? "countdown";
  const period =
    type === "evergreen"
      ? durationFields(timer.durationMinutes)
      : {
          startDate: timer.schedule.startDate,
          startTime: formatTimeOfDay(timer.schedule.startTime, locale),
          endDate: timer.schedule.endDate,
          endTime: formatTimeOfDay(timer.schedule.endTime, locale),
        };
  return {
    ...createEmptyForm(type),
    name: timer.name,
    description: timer.description,
    ...period,
    color: timer.color,
    size: timer.size,
    urgency: timer.urgency,
    targetType: timer.target.type,
    resources: timer.target.resources,
  };
}

/** Converts form state into the API payload. Call after `validateTimerForm` passes. */
export function toTimerPayload(form) {
  const period =
    form.type === "evergreen"
      ? { durationMinutes: durationFromForm(form) }
      : {
          startDate: form.startDate || null,
          startTime: parseTimeInput(form.startTime) || null,
          endDate: form.endDate,
          endTime: parseTimeInput(form.endTime),
        };
  return {
    type: form.type,
    name: form.name.trim(),
    description: form.description.trim(),
    ...period,
    color: form.color.toLowerCase(),
    size: form.size,
    urgency: form.urgency,
    target: {
      type: form.targetType,
      resourceIds: form.targetType === "all" ? [] : form.resources.map(({ id }) => id),
    },
  };
}

/** Countdown schedule checks. Wall-clock strings in one time zone compare correctly as text. */
function validateSchedule(form, { timeZone, now, initialEnd }, errors) {
  const startTime = parseTimeInput(form.startTime);
  const endTime = parseTimeInput(form.endTime);

  if (startTime === null) errors.startTime = "timeInvalid";
  else if (form.startDate && !startTime) errors.startTime = "startTimeRequired";
  if (!form.startDate && startTime) errors.startDate = "startDateRequired";

  if (!form.endDate) errors.endDate = "endDateRequired";
  if (endTime === null) errors.endTime = "timeInvalid";
  else if (!endTime) errors.endTime = "endTimeRequired";

  if (form.endDate && endTime && !errors.startDate && !errors.startTime) {
    const current = nowInTimeZone(timeZone, now);
    const start = form.startDate ? `${form.startDate}T${startTime}` : null;
    const end = `${form.endDate}T${endTime}`;
    const startDay = form.startDate || current.date;
    const endField = startDay === form.endDate ? "endTime" : "endDate";

    if (start && end <= start) {
      errors[endField] = "endBeforeStart";
    } else if (end !== initialEnd && end <= `${current.date}T${current.time}`) {
      errors[endField] = "endInPast";
    }
  }
}

/**
 * Evergreen duration checks. Unreadable values are flagged on their own field;
 * a total that's out of range is flagged on the duration as a whole.
 */
function validateDuration(form, errors) {
  for (const { field } of DURATION_FIELDS) {
    if (parseDurationPart(form[field]) === null) errors[field] = "durationPartInvalid";
  }
  if (DURATION_FIELDS.some(({ field }) => errors[field])) return;

  const total = durationFromForm(form);
  if (total < TIMER_LIMITS.DURATION_MIN_MINUTES) errors.duration = "durationRequired";
  else if (total > TIMER_LIMITS.DURATION_MAX_MINUTES) errors.duration = "durationTooLong";
}

/**
 * Client-side checks for instant feedback. Returns translation keys (under
 * `TimerForm.errors`) keyed by form field; an empty object means valid.
 *
 * @param {ReturnType<typeof createEmptyForm>} form
 * @param {{ timeZone?: string, now?: Date, initialEnd?: string | null }} context
 *   Countdowns only: `timeZone` is the shop's, and `initialEnd` is the saved
 *   "YYYY-MM-DDTHH:MM" end when editing (an unchanged end may stay in the past).
 */
export function validateTimerForm(form, { timeZone, now = new Date(), initialEnd = null } = {}) {
  const errors = {};

  const name = form.name.trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > TIMER_LIMITS.NAME_MAX_LENGTH) errors.name = "nameTooLong";

  if (form.description.trim().length > TIMER_LIMITS.DESCRIPTION_MAX_LENGTH) {
    errors.description = "descriptionTooLong";
  }

  if (form.type === "evergreen") validateDuration(form, errors);
  else validateSchedule(form, { timeZone, now, initialEnd }, errors);

  if (!HEX_COLOR.test(form.color)) errors.color = "colorInvalid";

  if (form.targetType !== "all" && form.resources.length === 0) {
    errors.resources = form.targetType === "products" ? "productsRequired" : "collectionsRequired";
  }

  return errors;
}

/** Maps server field paths (e.g. "target.resourceIds") onto form fields. */
export function mapServerFieldErrors(fields = {}) {
  const map = {
    "target.resourceIds": "resources",
    "target.type": "targetType",
    target: "resources",
    durationMinutes: "duration",
  };
  return Object.fromEntries(
    Object.entries(fields).map(([path, message]) => [map[path] ?? path, message]),
  );
}

/** Normalizes Resource Picker selections into the shape stored on a timer. */
export function resourcesFromPicker(selection, targetType) {
  return selection.map((item) => {
    const image = targetType === "products" ? item.images?.[0] : item.image;
    return {
      id: item.id,
      title: item.title,
      handle: item.handle ?? "",
      imageUrl: image?.originalSrc ?? image?.url ?? null,
      imageAlt: image?.altText ?? "",
    };
  });
}

/** Picks black or white text for legible contrast on `hex`. */
export function readableTextColor(hex) {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. black; pick the larger.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#1a1a1a";
}
