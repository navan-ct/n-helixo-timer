import { HttpError, NotFoundError, ValidationError } from "../lib/errors.js";

import { resolveSchedule, utcToZonedParts } from "./schedule.js";
import { TIMER_LIMITS, TIMER_SORTS } from "./timer.constants.js";
import { NAME_COLLATION } from "./timer.model.js";
import { isObjectId } from "./timer.validation.js";

const TIMER_NOT_FOUND = "Timer not found.";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Evergreen timers run separately for each shopper, so they're always active:
 * a shopper's countdown starts the first time they view a product it applies to.
 */
export function getTimerStatus(timer, now) {
  if (timer.type === "evergreen") return "active";
  if (timer.startsAt > now) return "scheduled";
  if (timer.endsAt <= now) return "expired";
  return "active";
}

/** Never matches a document. */
const NO_MATCH = { _id: null };

function statusFilter(type, status, now) {
  if (type === "evergreen") return status === "all" || status === "active" ? {} : NO_MATCH;
  switch (status) {
    case "active":
      return { startsAt: { $lte: now }, endsAt: { $gt: now } };
    case "scheduled":
      return { startsAt: { $gt: now } };
    case "expired":
      return { endsAt: { $lte: now } };
    default:
      return {};
  }
}

/** The type-specific part of an API response: a schedule, or a duration. */
function periodResponse(timer) {
  if (timer.type === "evergreen") return { durationMinutes: timer.durationMinutes };

  const start = utcToZonedParts(timer.startsAt, timer.timezone);
  const end = utcToZonedParts(timer.endsAt, timer.timezone);
  return {
    startsAt: timer.startsAt.toISOString(),
    endsAt: timer.endsAt.toISOString(),
    timezone: timer.timezone,
    schedule: {
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    },
  };
}

/** Shapes a stored timer for API responses. */
export function toTimerResponse(timer, now) {
  return {
    id: timer._id.toString(),
    type: timer.type,
    name: timer.name,
    description: timer.description,
    ...periodResponse(timer),
    color: timer.color,
    size: timer.size,
    urgency: timer.urgency,
    target: {
      type: timer.target.type,
      resources: timer.target.resources.map(({ id, title, handle, imageUrl, imageAlt }) => ({
        id,
        title,
        handle,
        imageUrl,
        imageAlt,
      })),
    },
    status: getTimerStatus(timer, now),
    createdAt: timer.createdAt.toISOString(),
    updatedAt: timer.updatedAt.toISOString(),
  };
}

/**
 * Business logic for timers of every type. Every operation is scoped to the
 * authenticated shop, so one merchant can never read or change another's timers.
 *
 * @param {{
 *   Timer: import("mongoose").Model<any>,
 *   adminApi: ReturnType<typeof import("../shopify/admin-api.js").createShopifyAdminApi>,
 *   now?: () => Date,
 *   onChange?: (shop: string) => void,
 *   impressionsByTimer?: (shop: string, timerIds: string[]) => Promise<Map<string, number>>,
 * }} deps
 *   `onChange` runs after a shop's timers are created, updated or deleted (the
 *   storefront read model uses it to drop its cache). `impressionsByTimer`
 *   gives each listed timer its all-time impressions (analytics/analytics.service.js).
 */
export function createTimerService({
  Timer,
  adminApi,
  now = () => new Date(),
  onChange = () => {},
  impressionsByTimer = async () => new Map(),
}) {
  async function findOwned(shop, id) {
    if (!isObjectId(id)) throw new NotFoundError(TIMER_NOT_FOUND);
    const timer = await Timer.findOne({ _id: id, shop });
    if (!timer) throw new NotFoundError(TIMER_NOT_FOUND);
    return timer;
  }

  /** The stored fields that set when a timer runs, which depend on its type. */
  async function buildPeriodFields(session, input, previous) {
    if (input.type === "evergreen") return { durationMinutes: input.durationMinutes };

    const timezone = previous?.timezone ?? (await adminApi.getShopTimezone(session));
    const { startsAt, endsAt } = resolveSchedule(input, {
      zone: timezone,
      now: now(),
      previousEndsAt: previous?.endsAt,
    });
    return { startsAt, endsAt, timezone };
  }

  /** Converts validated input into the stored document fields. */
  async function buildTimerFields(session, input, { previous } = {}) {
    const period = await buildPeriodFields(session, input, previous);
    const resources =
      input.target.type === "all"
        ? []
        : await adminApi.resolveTargetResources(
            session,
            input.target.type,
            input.target.resourceIds,
          );

    return {
      type: input.type,
      name: input.name,
      description: input.description,
      ...period,
      color: input.color,
      size: input.size,
      urgency: input.urgency,
      target: { type: input.target.type, resources },
    };
  }

  return {
    /** Lists one type of timer. Countdown lists include the shop's time zone, for scheduling. */
    async list(session, { type, query, status, sort, page }) {
      const currentTime = now();
      const filter = { shop: session.shop, type, ...statusFilter(type, status, currentTime) };
      if (query) {
        const pattern = new RegExp(escapeRegExp(query), "i");
        filter.$or = [{ name: pattern }, { description: pattern }];
      }

      const pageSize = TIMER_LIMITS.PAGE_SIZE;
      let cursor = Timer.find(filter)
        .sort(TIMER_SORTS[sort])
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean();
      if (sort.startsWith("name_")) cursor = cursor.collation(NAME_COLLATION);

      const [timers, total, timezone] = await Promise.all([
        cursor,
        Timer.countDocuments(filter),
        // Evergreen timers have no schedule, so they don't need the time zone.
        type === "countdown" ? adminApi.getShopTimezone(session) : undefined,
      ]);
      const impressions = await impressionsByTimer(
        session.shop,
        timers.map((timer) => timer._id.toString()),
      );

      return {
        timers: timers.map((timer) => ({
          ...toTimerResponse(timer, currentTime),
          impressions: impressions.get(timer._id.toString()) ?? 0,
        })),
        pageInfo: {
          page,
          pageSize,
          total,
          hasPreviousPage: page > 1,
          hasNextPage: page * pageSize < total,
        },
        ...(timezone && { timezone }),
      };
    },

    /**
     * How many timers of each kind the shop has right now: countdowns that are
     * running, countdowns that start later, and evergreen timers (always running).
     */
    async counts(session) {
      const currentTime = now();
      const countdowns = { shop: session.shop, type: "countdown" };
      const [running, scheduled, evergreen] = await Promise.all([
        Timer.countDocuments({
          ...countdowns,
          ...statusFilter("countdown", "active", currentTime),
        }),
        Timer.countDocuments({
          ...countdowns,
          ...statusFilter("countdown", "scheduled", currentTime),
        }),
        Timer.countDocuments({ shop: session.shop, type: "evergreen" }),
      ]);
      return { running, scheduled, evergreen };
    },

    async get(session, id) {
      const timer = await findOwned(session.shop, id);
      return toTimerResponse(timer, now());
    },

    async create(session, input) {
      const count = await Timer.countDocuments({ shop: session.shop });
      if (count >= TIMER_LIMITS.MAX_TIMERS_PER_SHOP) {
        throw new HttpError(
          409,
          "TIMER_LIMIT_REACHED",
          `You can have up to ${TIMER_LIMITS.MAX_TIMERS_PER_SHOP} timers. Delete a timer to create a new one.`,
        );
      }

      const fields = await buildTimerFields(session, input);
      const timer = await Timer.create({ shop: session.shop, ...fields });
      onChange(session.shop);
      return toTimerResponse(timer, now());
    },

    async update(session, id, input) {
      const timer = await findOwned(session.shop, id);
      if (input.type !== timer.type) {
        throw new ValidationError({ type: "A timer’s type can’t be changed." });
      }
      const fields = await buildTimerFields(session, input, { previous: timer });
      timer.set(fields);
      await timer.save();
      onChange(session.shop);
      return toTimerResponse(timer, now());
    },

    async remove(session, id) {
      if (!isObjectId(id)) throw new NotFoundError(TIMER_NOT_FOUND);
      const { deletedCount } = await Timer.deleteOne({ _id: id, shop: session.shop });
      if (!deletedCount) throw new NotFoundError(TIMER_NOT_FOUND);
      onChange(session.shop);
    },

    /** Deletes all of a shop's data (used by the shop/redact privacy webhook). */
    async removeAllForShop(shop) {
      const { deletedCount } = await Timer.deleteMany({ shop });
      onChange(shop);
      return deletedCount;
    },
  };
}
