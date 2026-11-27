import { formatTimeOfDay, nowInTimeZone, parseTimeInput } from "./time";

/** Mirrors web/timers/timer.constants.js. The server remains authoritative. */
export const TIMER_LIMITS = Object.freeze({
  NAME_MAX_LENGTH: 80,
  DESCRIPTION_MAX_LENGTH: 500,
  MAX_TARGET_RESOURCES: 100,
});

export const TIMER_SIZES = ["small", "medium", "large"];
export const URGENCY_EFFECTS = ["color_pulse", "shake", "none"];
export const TARGET_TYPES = ["all", "products", "collections"];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** @typedef {{ id: string, title: string, handle?: string, imageUrl?: string | null, imageAlt?: string }} TargetResource */

/**
 * Form state. Times hold the text the merchant typed (e.g. "9:30 PM") and are
 * parsed on validation and submit.
 */
export function createEmptyForm() {
  return {
    name: "",
    description: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    color: "#008060",
    size: "medium",
    urgency: "color_pulse",
    targetType: "all",
    /** @type {TargetResource[]} */
    resources: [],
  };
}

/** Builds form state from a timer returned by the API. */
export function formFromTimer(timer, locale) {
  return {
    name: timer.name,
    description: timer.description,
    startDate: timer.schedule.startDate,
    startTime: formatTimeOfDay(timer.schedule.startTime, locale),
    endDate: timer.schedule.endDate,
    endTime: formatTimeOfDay(timer.schedule.endTime, locale),
    color: timer.color,
    size: timer.size,
    urgency: timer.urgency,
    targetType: timer.target.type,
    resources: timer.target.resources,
  };
}

/** Converts form state into the API payload. Call after `validateTimerForm` passes. */
export function toTimerPayload(form) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    startDate: form.startDate || null,
    startTime: parseTimeInput(form.startTime) || null,
    endDate: form.endDate,
    endTime: parseTimeInput(form.endTime),
    color: form.color.toLowerCase(),
    size: form.size,
    urgency: form.urgency,
    target: {
      type: form.targetType,
      resourceIds: form.targetType === "all" ? [] : form.resources.map(({ id }) => id),
    },
  };
}

/**
 * Client-side checks for instant feedback. Returns translation keys (under
 * `TimerForm.errors`) keyed by form field; an empty object means valid.
 *
 * Wall-clock strings in the same time zone compare correctly as text, which
 * keeps this free of browser time zone assumptions.
 *
 * @param {ReturnType<typeof createEmptyForm>} form
 * @param {{ timeZone: string, now?: Date, initialEnd?: string | null }} context
 *   `initialEnd` is the saved "YYYY-MM-DDTHH:MM" end when editing; an unchanged
 *   end may stay in the past.
 */
export function validateTimerForm(form, { timeZone, now = new Date(), initialEnd = null }) {
  const errors = {};

  const name = form.name.trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > TIMER_LIMITS.NAME_MAX_LENGTH) errors.name = "nameTooLong";

  if (form.description.trim().length > TIMER_LIMITS.DESCRIPTION_MAX_LENGTH) {
    errors.description = "descriptionTooLong";
  }

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
