import { DateTime } from "luxon";
import { z } from "zod";

import { ValidationError } from "../lib/errors.js";

import {
  DEFAULT_SORT,
  TARGET_RESOURCE_TYPENAMES,
  TARGET_TYPES,
  TIMER_LIMITS,
  TIMER_SIZES,
  TIMER_SORTS,
  TIMER_SORTS_BY_TYPE,
  TIMER_STATUSES,
  TIMER_TYPES,
  URGENCY_EFFECTS,
} from "./timer.constants.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const GID_BY_TARGET = {
  products: /^gid:\/\/shopify\/Product\/\d+$/,
  collections: /^gid:\/\/shopify\/Collection\/\d+$/,
};

// Matches tag-like sequences (`<b>`, `</div>`, `<!-- -->`, `<img src=x>`) without
// touching plain comparisons such as "5 < 10".
const HTML_TAG = /<\/?[a-z!][^<>]*>/gi;
// C0/C1 control characters except tab (\t) and newline (\n), plus zero-width and
// bidi-override characters that can be used to disguise text.
const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Normalizes merchant-entered text into safe plain text: strips HTML tags and
 * invisible/control characters, normalizes Unicode and whitespace.
 *
 * Timer text is always rendered as text (never as HTML), so this is defense in
 * depth for any future surface that renders it, such as the storefront.
 *
 * @param {string} value
 * @param {{ multiline?: boolean }} [options]
 */
export function sanitizeText(value, { multiline = false } = {}) {
  let text = String(value).normalize("NFC").replace(/\r\n?/g, "\n");
  text = text.replace(HTML_TAG, "").replace(UNSAFE_CHARS, "");

  if (multiline) {
    return text
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return text.replace(/\s+/g, " ").trim();
}

function isCalendarDate(value) {
  return DateTime.fromISO(value, { zone: "utc" }).isValid;
}

const emptyToNull = (value) => (value === "" || value === undefined ? null : value);

const dateField = (requiredMessage) =>
  z
    .string({ error: requiredMessage })
    .regex(ISO_DATE, { error: "Enter a date in YYYY-MM-DD format." })
    .refine(isCalendarDate, { error: "Enter a valid date." });

const timeField = (requiredMessage) =>
  z
    .string({ error: requiredMessage })
    .regex(TIME_24H, { error: "Enter a time in 24-hour HH:MM format." });

const optionalDate = z.preprocess(emptyToNull, dateField("Enter a date.").nullable());
const optionalTime = z.preprocess(emptyToNull, timeField("Enter a time.").nullable());

const targetSchema = z
  .object({
    type: z.enum(TARGET_TYPES, { error: "Select where the timer appears." }),
    resourceIds: z
      .array(z.string({ error: "Resource IDs must be strings." }), {
        error: "Resource IDs must be a list.",
      })
      .max(TIMER_LIMITS.MAX_TARGET_RESOURCES, {
        error: `Select up to ${TIMER_LIMITS.MAX_TARGET_RESOURCES} items.`,
      })
      .default([]),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.type === "all") {
      if (target.resourceIds.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["resourceIds"],
          message: "Don’t select items when the timer applies to all products.",
        });
      }
      return;
    }

    if (target.resourceIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceIds"],
        message:
          target.type === "products"
            ? "Select at least one product."
            : "Select at least one collection.",
      });
      return;
    }

    const pattern = GID_BY_TARGET[target.type];
    const invalid = target.resourceIds.some((id) => !pattern.test(id));
    if (invalid) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceIds"],
        message: `Selected items must be Shopify ${TARGET_RESOURCE_TYPENAMES[target.type].toLowerCase()}s.`,
      });
    }
  })
  .transform((target) => ({
    ...target,
    resourceIds: [...new Set(target.resourceIds)],
  }));

/** Fields every timer has, whatever its type. */
const sharedTimerFields = {
  name: z
    .string({ error: "Enter a timer name." })
    .transform((value) => sanitizeText(value))
    .pipe(
      z
        .string()
        .min(1, { error: "Enter a timer name." })
        .max(TIMER_LIMITS.NAME_MAX_LENGTH, {
          error: `Name can’t be longer than ${TIMER_LIMITS.NAME_MAX_LENGTH} characters.`,
        }),
    ),
  description: z
    .string({ error: "Description must be text." })
    .default("")
    .transform((value) => sanitizeText(value, { multiline: true }))
    .pipe(
      z.string().max(TIMER_LIMITS.DESCRIPTION_MAX_LENGTH, {
        error: `Description can’t be longer than ${TIMER_LIMITS.DESCRIPTION_MAX_LENGTH} characters.`,
      }),
    ),
  color: z
    .string({ error: "Select a timer color." })
    .regex(HEX_COLOR, { error: "Enter a valid hex color." })
    .transform((value) => value.toLowerCase()),
  size: z.enum(TIMER_SIZES, { error: "Select a timer size." }),
  urgency: z.enum(URGENCY_EFFECTS, { error: "Select an urgency notification." }),
  target: targetSchema,
};

/**
 * A countdown runs on one schedule for every shopper. Dates and times are
 * wall-clock values in the shop's time zone; the service converts them to UTC
 * instants. `type` may be left out, since countdowns came first.
 */
const countdownInputSchema = z
  .object({
    type: z.literal("countdown").default("countdown"),
    ...sharedTimerFields,
    startDate: optionalDate.default(null),
    startTime: optionalTime.default(null),
    endDate: dateField("Enter an end date."),
    endTime: timeField("Enter an end time."),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.startDate && !input.startTime) {
      ctx.addIssue({ code: "custom", path: ["startTime"], message: "Enter a start time." });
    }
    if (input.startTime && !input.startDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Enter a start date." });
    }
  });

const MAX_DURATION_DAYS = TIMER_LIMITS.DURATION_MAX_MINUTES / (24 * 60);

/**
 * An evergreen timer runs for `durationMinutes` from each shopper's first visit,
 * so it has no schedule.
 */
const evergreenInputSchema = z
  .object({
    type: z.literal("evergreen"),
    ...sharedTimerFields,
    durationMinutes: z
      .number({ error: "Enter a duration." })
      .int({ error: "Duration must be in whole minutes." })
      .min(TIMER_LIMITS.DURATION_MIN_MINUTES, { error: "Duration must be at least 1 minute." })
      .max(TIMER_LIMITS.DURATION_MAX_MINUTES, {
        error: `Duration can’t be longer than ${MAX_DURATION_DAYS} days.`,
      }),
  })
  .strict();

/** Body schema for creating or replacing a timer of either type. */
export const timerInputSchema = z.discriminatedUnion(
  "type",
  [countdownInputSchema, evergreenInputSchema],
  {
    error: (issue) => (issue.code === "invalid_union" ? "Select a timer type." : undefined),
  },
);

export const listQuerySchema = z
  .object({
    type: z.enum(TIMER_TYPES, { error: "Unknown timer type." }).default("countdown"),
    query: z
      .string({ error: "Search must be text." })
      .trim()
      .max(TIMER_LIMITS.SEARCH_MAX_LENGTH, {
        error: `Search can’t be longer than ${TIMER_LIMITS.SEARCH_MAX_LENGTH} characters.`,
      })
      .default(""),
    status: z.enum(["all", ...TIMER_STATUSES], { error: "Unknown status filter." }).default("all"),
    sort: z.enum(Object.keys(TIMER_SORTS), { error: "Unknown sort order." }).default(DEFAULT_SORT),
    page: z.coerce
      .number({ error: "Page must be a number." })
      .int({ error: "Page must be a whole number." })
      .min(1, { error: "Page must be 1 or greater." })
      .max(10_000, { error: "Page is out of range." })
      .default(1),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (!TIMER_SORTS_BY_TYPE[query.type].includes(query.sort)) {
      ctx.addIssue({ code: "custom", path: ["sort"], message: "Unknown sort order." });
    }
  });

export function isObjectId(value) {
  return typeof value === "string" && OBJECT_ID.test(value);
}

/** Converts a ZodError into `{ "field.path": "message" }`, keeping the first message per field. */
export function toFieldErrors(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_root";
    if (!(key in fields)) {
      fields[key] =
        issue.code === "unrecognized_keys"
          ? `Unknown field: ${issue.keys.join(", ")}.`
          : issue.message;
    }
  }
  return fields;
}

/**
 * Parses `input` with `schema`, throwing a ValidationError with per-field
 * messages when it doesn't match.
 */
export function parseOrThrow(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(toFieldErrors(result.error));
  }
  return result.data;
}
