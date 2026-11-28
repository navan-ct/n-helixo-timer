/**
 * Shared constraints for timers. The frontend mirrors these limits in
 * web/frontend/utils/timerForm.js so merchants see errors before submitting;
 * the server remains the source of truth.
 */

export const TIMER_LIMITS = Object.freeze({
  NAME_MAX_LENGTH: 80,
  DESCRIPTION_MAX_LENGTH: 500,
  MAX_TARGET_RESOURCES: 100,
  /** Shared by all timer types. */
  MAX_TIMERS_PER_SHOP: 200,
  SEARCH_MAX_LENGTH: 100,
  PAGE_SIZE: 20,
  /** Evergreen timers run for at least a minute and at most a year per shopper. */
  DURATION_MIN_MINUTES: 1,
  DURATION_MAX_MINUTES: 365 * 24 * 60,
});

/**
 * - `countdown`: one schedule for everyone, from a start to an end date and time.
 * - `evergreen`: a fixed duration that each shopper's browser starts on their
 *   first visit, so every shopper gets their own countdown.
 */
export const TIMER_TYPES = Object.freeze(["countdown", "evergreen"]);

export const TIMER_SIZES = Object.freeze(["small", "medium", "large"]);
export const URGENCY_EFFECTS = Object.freeze(["color_pulse", "shake", "none"]);
export const TARGET_TYPES = Object.freeze(["all", "products", "collections"]);
export const TIMER_STATUSES = Object.freeze(["active", "scheduled", "expired"]);

export const TIMER_DEFAULTS = Object.freeze({
  color: "#008060",
  size: "medium",
  urgency: "color_pulse",
});

/** Sort keys accepted by the list endpoint, mapped to MongoDB sort specs. */
export const TIMER_SORTS = Object.freeze({
  created_desc: { createdAt: -1, _id: -1 },
  created_asc: { createdAt: 1, _id: 1 },
  start_asc: { startsAt: 1, _id: 1 },
  start_desc: { startsAt: -1, _id: -1 },
  end_asc: { endsAt: 1, _id: 1 },
  duration_asc: { durationMinutes: 1, _id: 1 },
  duration_desc: { durationMinutes: -1, _id: -1 },
  name_asc: { name: 1, _id: 1 },
  name_desc: { name: -1, _id: -1 },
});

/** The sorts that make sense for each timer type: only countdowns have a schedule. */
export const TIMER_SORTS_BY_TYPE = Object.freeze({
  countdown: Object.freeze([
    "created_desc",
    "created_asc",
    "start_asc",
    "start_desc",
    "end_asc",
    "name_asc",
    "name_desc",
  ]),
  evergreen: Object.freeze([
    "created_desc",
    "created_asc",
    "duration_asc",
    "duration_desc",
    "name_asc",
    "name_desc",
  ]),
});

export const DEFAULT_SORT = "created_desc";

/** Admin GraphQL `__typename` for each resource-backed target type. */
export const TARGET_RESOURCE_TYPENAMES = Object.freeze({
  products: "Product",
  collections: "Collection",
});
