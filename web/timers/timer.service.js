import { HttpError, NotFoundError } from "../lib/errors.js";

import { resolveSchedule, utcToZonedParts } from "./schedule.js";
import { TIMER_LIMITS, TIMER_SORTS } from "./timer.constants.js";
import { NAME_COLLATION } from "./timer.model.js";
import { isObjectId } from "./timer.validation.js";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getTimerStatus(timer, now) {
  if (timer.startsAt > now) return "scheduled";
  if (timer.endsAt <= now) return "expired";
  return "active";
}

function statusFilter(status, now) {
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

/** Shapes a stored timer for API responses. */
export function toTimerResponse(timer, now) {
  const start = utcToZonedParts(timer.startsAt, timer.timezone);
  const end = utcToZonedParts(timer.endsAt, timer.timezone);

  return {
    id: timer._id.toString(),
    name: timer.name,
    description: timer.description,
    startsAt: timer.startsAt.toISOString(),
    endsAt: timer.endsAt.toISOString(),
    timezone: timer.timezone,
    schedule: {
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    },
    color: timer.color,
    size: timer.size,
    position: timer.position,
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
 * Business logic for countdown timers. Every operation is scoped to the
 * authenticated shop, so one merchant can never read or change another's timers.
 *
 * @param {{
 *   Timer: import("mongoose").Model<any>,
 *   adminApi: ReturnType<typeof import("../shopify/admin-api.js").createShopifyAdminApi>,
 *   now?: () => Date,
 *   onChange?: (shop: string) => void,
 * }} deps
 *   `onChange` runs after a shop's timers are created, updated or deleted (the
 *   storefront read model uses it to drop its cache).
 */
export function createTimerService({
  Timer,
  adminApi,
  now = () => new Date(),
  onChange = () => {},
}) {
  async function findOwned(shop, id) {
    if (!isObjectId(id)) throw new NotFoundError("Timer not found.");
    const timer = await Timer.findOne({ _id: id, shop });
    if (!timer) throw new NotFoundError("Timer not found.");
    return timer;
  }

  /** Converts validated input into the stored document fields. */
  async function buildTimerFields(session, input, { previous } = {}) {
    const timezone = previous?.timezone ?? (await adminApi.getShopTimezone(session));
    const { startsAt, endsAt } = resolveSchedule(input, {
      zone: timezone,
      now: now(),
      previousEndsAt: previous?.endsAt,
    });

    const resources =
      input.target.type === "all"
        ? []
        : await adminApi.resolveTargetResources(
            session,
            input.target.type,
            input.target.resourceIds,
          );

    return {
      name: input.name,
      description: input.description,
      startsAt,
      endsAt,
      timezone,
      color: input.color,
      size: input.size,
      position: input.position,
      urgency: input.urgency,
      target: { type: input.target.type, resources },
    };
  }

  return {
    async list(session, { query, status, sort, page }) {
      const currentTime = now();
      const filter = { shop: session.shop, ...statusFilter(status, currentTime) };
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
        adminApi.getShopTimezone(session),
      ]);

      return {
        timers: timers.map((timer) => toTimerResponse(timer, currentTime)),
        pageInfo: {
          page,
          pageSize,
          total,
          hasPreviousPage: page > 1,
          hasNextPage: page * pageSize < total,
        },
        timezone,
      };
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
          `You can have up to ${TIMER_LIMITS.MAX_TIMERS_PER_SHOP} timers. Delete an old timer to create a new one.`,
        );
      }

      const fields = await buildTimerFields(session, input);
      const timer = await Timer.create({ shop: session.shop, ...fields });
      onChange(session.shop);
      return toTimerResponse(timer, now());
    },

    async update(session, id, input) {
      const timer = await findOwned(session.shop, id);
      const fields = await buildTimerFields(session, input, { previous: timer });
      timer.set(fields);
      await timer.save();
      onChange(session.shop);
      return toTimerResponse(timer, now());
    },

    async remove(session, id) {
      if (!isObjectId(id)) throw new NotFoundError("Timer not found.");
      const { deletedCount } = await Timer.deleteOne({ _id: id, shop: session.shop });
      if (!deletedCount) throw new NotFoundError("Timer not found.");
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
