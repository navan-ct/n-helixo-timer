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
  description: 1,
  startsAt: 1,
  endsAt: 1,
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
  return {
    id: doc._id.toString(),
    message: doc.description,
    startsAt: doc.startsAt.getTime(),
    endsAt: doc.endsAt.getTime(),
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

/** The public shape sent to the storefront. Merchant-only fields (name, targeting) stay private. */
function toStorefrontTimer(timer) {
  return {
    id: timer.id,
    // Every timer is a countdown today; the widget switches on `type` so other
    // kinds of timers can be added without changing this contract.
    type: "countdown",
    startsAt: new Date(timer.startsAt).toISOString(),
    endsAt: new Date(timer.endsAt).toISOString(),
    message: timer.message,
    color: timer.color,
    size: timer.size,
    urgency: timer.urgency,
  };
}

/**
 * Read model for the storefront widget.
 *
 * Each shop's unexpired timers are loaded with one query and cached in memory,
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
    const docs = await Timer.find({ shop, endsAt: { $gt: now() } }, PROJECTION)
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
     * "all products", and among equals the one ending soonest wins.
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
        if (timer.endsAt <= currentTime || timer.startsAt > horizon) continue;
        const specificity = specificityFor(timer, product, collections);
        if (specificity > 0) matches.push({ timer, specificity });
      }

      matches.sort(
        (a, b) =>
          b.specificity - a.specificity ||
          a.timer.endsAt - b.timer.endsAt ||
          b.timer.createdAt - a.timer.createdAt,
      );

      return {
        timers: matches
          .slice(0, MAX_TIMERS_PER_RESPONSE)
          .map(({ timer }) => toStorefrontTimer(timer)),
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
