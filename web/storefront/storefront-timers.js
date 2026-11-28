import { TIMER_LIMITS } from "../timers/timer.constants.js";

/** How long a shop's live timers stay cached in memory before MongoDB is asked again. */
export const CACHE_TTL_MS = 30_000;
/** Upper bound on cached shops; the least recently used shop is evicted first. */
export const MAX_CACHED_SHOPS = 5_000;
/**
 * Timers that start within this window are sent ahead of time, so the widget
 * can switch to them at the exact second without another request.
 */
export const LOOKAHEAD_MS = 15 * 60_000;
/** Most timers returned for one product. */
export const MAX_TIMERS_PER_RESPONSE = 10;
/** How often the widget should refresh, in seconds. Sent with every response. */
export const REFRESH_INTERVAL_SECONDS = 60;

/** Higher wins when several timers apply to the same product at once. */
const SPECIFICITY = { products: 3, collections: 2, all: 1 };

const PROJECTION = {
  _id: 1,
  type: 1,
  description: 1,
  startsAt: 1,
  endsAt: 1,
  durationMinutes: 1,
  color: 1,
  size: 1,
  urgency: 1,
  "target.type": 1,
  "target.resources.id": 1,
  createdAt: 1,
};

const productGid = (id) => `gid://shopify/Product/${id}`;
const collectionGid = (id) => `gid://shopify/Collection/${id}`;

/** Prepares a stored timer for fast matching. Only data the storefront needs is kept. */
function toCachedTimer(doc) {
  const evergreen = doc.type === "evergreen";
  return {
    id: doc._id.toString(),
    type: doc.type,
    message: doc.description,
    // Evergreen timers have no schedule: each shopper's browser starts its own.
    startsAt: evergreen ? null : doc.startsAt.getTime(),
    endsAt: evergreen ? null : doc.endsAt.getTime(),
    durationMinutes: evergreen ? doc.durationMinutes : null,
    createdAt: doc.createdAt?.getTime() ?? 0,
    color: doc.color,
    size: doc.size,
    urgency: doc.urgency,
    targetType: doc.target.type,
    resourceIds: new Set(doc.target.resources.map((resource) => resource.id)),
  };
}

function specificityFor(timer, product, collections) {
  switch (timer.targetType) {
    case "all":
      return SPECIFICITY.all;
    case "products":
      return timer.resourceIds.has(product) ? SPECIFICITY.products : 0;
    case "collections":
      return collections.some((id) => timer.resourceIds.has(id)) ? SPECIFICITY.collections : 0;
    default:
      return 0;
  }
}

/**
 * Whether a timer can be on screen between now and `horizon`. Evergreen timers
 * always can: the server can't know where each shopper's countdown is.
 */
function isLive(timer, currentTime, horizon) {
  if (timer.type === "evergreen") return true;
  return timer.endsAt > currentTime && timer.startsAt <= horizon;
}

/**
 * When a timer ends, for ordering. An evergreen timer's end depends on the
 * shopper; this is the end for a shopper who arrives now, the latest it can be.
 */
const endForOrdering = (timer, currentTime) =>
  timer.type === "evergreen" ? currentTime + timer.durationMinutes * 60_000 : timer.endsAt;

/**
 * The public shape sent to the storefront. Merchant-only fields (name, targeting)
 * stay private. The widget switches on `type` and skips types it doesn't know.
 * `priority` is how specifically the timer targets the product (higher wins);
 * the widget needs it to place evergreen timers once it knows when they end.
 */
function toStorefrontTimer(timer, priority) {
  const period =
    timer.type === "evergreen"
      ? { durationMinutes: timer.durationMinutes }
      : {
          startsAt: new Date(timer.startsAt).toISOString(),
          endsAt: new Date(timer.endsAt).toISOString(),
        };
  return {
    id: timer.id,
    type: timer.type,
    ...period,
    message: timer.message,
    color: timer.color,
    size: timer.size,
    urgency: timer.urgency,
    priority,
  };
}

/**
 * Read model for the storefront widget.
 *
 * Each shop's unexpired timers (countdowns that haven't ended, and every
 * evergreen timer) are loaded with one query and cached in memory,
 * so storefront traffic (every product view, every poll) is answered without
 * touching MongoDB. Concurrent misses for the same shop share one query. The
 * admin API calls `invalidate(shop)` after every change so this instance picks
 * it up immediately; other instances pick it up within `cacheTtlMs`.
 *
 * @param {{
 *   Timer: import("mongoose").Model<any>,
 *   now?: () => Date,
 *   cacheTtlMs?: number,
 *   maxCachedShops?: number,
 * }} deps
 */
export function createStorefrontTimers({
  Timer,
  now = () => new Date(),
  cacheTtlMs = CACHE_TTL_MS,
  maxCachedShops = MAX_CACHED_SHOPS,
}) {
  /** shop -> { expiresAt, timers } or { pending } while loading */
  const cache = new Map();
  /** Bumped on invalidation so a query that started earlier can't overwrite fresh state. */
  const generations = new Map();

  function remember(shop, entry) {
    cache.delete(shop);
    cache.set(shop, entry);
    while (cache.size > maxCachedShops) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      generations.delete(oldest);
    }
  }

  async function load(shop) {
    const live = { $or: [{ type: "evergreen" }, { endsAt: { $gt: now() } }] };
    const docs = await Timer.find({ shop, ...live }, PROJECTION)
      .sort({ startsAt: 1, _id: 1 })
      .limit(TIMER_LIMITS.MAX_TIMERS_PER_SHOP)
      .lean();
    return docs.map(toCachedTimer);
  }

  async function liveTimers(shop) {
    const entry = cache.get(shop);
    const currentTime = now().getTime();
    if (entry?.timers && entry.expiresAt > currentTime) {
      remember(shop, entry);
      return entry.timers;
    }
    if (entry?.pending) return entry.pending;

    const generation = generations.get(shop) ?? 0;
    const pending = load(shop).then(
      (timers) => {
        if ((generations.get(shop) ?? 0) === generation) {
          remember(shop, { timers, expiresAt: now().getTime() + cacheTtlMs });
        }
        return timers;
      },
      (error) => {
        if (cache.get(shop)?.pending === pending) cache.delete(shop);
        throw error;
      },
    );
    remember(shop, { pending });
    return pending;
  }

  return {
    /**
     * Timers to show on one product page, in priority order: the widget shows
     * the first one that is running. Products beat collections, collections beat
     * "all products", and among equals the one ending soonest wins (the widget
     * re-checks that once it knows when each shopper's evergreen timers end).
     *
     * @param {string} shop
     * @param {{ productId: string, collectionIds: string[] }} product Numeric IDs from Liquid
     */
    async forProduct(shop, { productId, collectionIds }) {
      const timers = await liveTimers(shop);
      const currentTime = now().getTime();
      const horizon = currentTime + LOOKAHEAD_MS;
      const product = productGid(productId);
      const collections = collectionIds.map(collectionGid);

      const matches = [];
      for (const timer of timers) {
        if (!isLive(timer, currentTime, horizon)) continue;
        const specificity = specificityFor(timer, product, collections);
        if (specificity > 0) {
          matches.push({ timer, specificity, endsAt: endForOrdering(timer, currentTime) });
        }
      }

      matches.sort(
        (a, b) =>
          b.specificity - a.specificity ||
          a.endsAt - b.endsAt ||
          b.timer.createdAt - a.timer.createdAt,
      );

      return {
        timers: matches
          .slice(0, MAX_TIMERS_PER_RESPONSE)
          .map(({ timer, specificity }) => toStorefrontTimer(timer, specificity)),
        serverTime: new Date(currentTime).toISOString(),
        refreshInterval: REFRESH_INTERVAL_SECONDS,
      };
    },

    /** Drops a shop's cached timers. Called after any change to them. */
    invalidate(shop) {
      cache.delete(shop);
      generations.set(shop, (generations.get(shop) ?? 0) + 1);
    },
  };
}
