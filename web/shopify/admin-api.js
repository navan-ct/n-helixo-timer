import { UpstreamError, ValidationError } from "../lib/errors.js";
import { FALLBACK_TIME_ZONE, isValidTimeZone } from "../timers/schedule.js";
import { TARGET_RESOURCE_TYPENAMES } from "../timers/timer.constants.js";

const SHOP_TIMEZONE_QUERY = `#graphql
  query ShopTimezone {
    shop {
      ianaTimezone
    }
  }
`;

const TARGET_RESOURCES_QUERY = `#graphql
  query TimerTargetResources($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        handle
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 120, maxHeight: 120 })
              altText
            }
          }
        }
      }
      ... on Collection {
        id
        title
        handle
        image {
          url(transform: { maxWidth: 120, maxHeight: 120 })
          altText
        }
      }
    }
  }
`;

const TIMEZONE_CACHE_TTL_MS = 60 * 60 * 1000;

function toTargetResource(node) {
  const image = node.__typename === "Product" ? node.featuredMedia?.preview?.image : node.image;
  return {
    id: node.id,
    title: node.title,
    handle: node.handle ?? "",
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText ?? "",
  };
}

const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

/**
 * Thin adapter over the Admin GraphQL API used by the timer service. Keeping
 * Shopify calls behind this interface lets tests swap in a fake.
 *
 * Each request is bounded by `timeoutMs` and retried `retries` times on
 * throttling and server errors (the client backs off between attempts).
 *
 * @param {{
 *   createClient: (session: import("@shopify/shopify-api").Session) => { request: Function },
 *   logger: import("pino").Logger,
 *   timeoutMs?: number,
 *   retries?: number,
 *   now?: () => number,
 * }} deps
 */
export function createShopifyAdminApi({
  createClient,
  logger,
  timeoutMs = 10_000,
  retries = 2,
  now = () => Date.now(),
}) {
  const log = logger.child({ component: "admin-api" });
  const timezoneCache = new Map();

  async function request(session, query, variables) {
    try {
      const client = createClient(session);
      const response = await client.request(query, {
        ...(variables && { variables }),
        retries,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.errors) {
        throw new Error(JSON.stringify(response.errors));
      }
      return response.data;
    } catch (error) {
      const timedOut = isTimeout(error);
      log.error({ shop: session.shop, err: error, timedOut }, "Shopify Admin API request failed");
      throw new UpstreamError({ timedOut });
    }
  }

  return {
    /** Returns the shop's IANA time zone, cached for an hour per shop. */
    async getShopTimezone(session) {
      const cached = timezoneCache.get(session.shop);
      if (cached && cached.expiresAt > now()) return cached.value;

      const data = await request(session, SHOP_TIMEZONE_QUERY);
      const zone = data?.shop?.ianaTimezone;
      const value = isValidTimeZone(zone) ? zone : FALLBACK_TIME_ZONE;
      if (value !== zone) {
        log.warn({ shop: session.shop, zone }, "Shop has an unrecognized time zone; using UTC");
      }

      timezoneCache.set(session.shop, { value, expiresAt: now() + TIMEZONE_CACHE_TTL_MS });
      return value;
    },

    /**
     * Loads products or collections by ID from the shop, verifying that every
     * ID exists and has the expected type. Titles and images come from Shopify
     * rather than the client, so stored display data can't be spoofed.
     *
     * @param {"products" | "collections"} targetType
     * @param {string[]} ids
     */
    async resolveTargetResources(session, targetType, ids) {
      if (ids.length === 0) return [];

      const data = await request(session, TARGET_RESOURCES_QUERY, { ids });
      const expectedType = TARGET_RESOURCE_TYPENAMES[targetType];
      const nodes = data?.nodes ?? [];

      const missing = ids.filter((_, index) => nodes[index]?.__typename !== expectedType);
      if (missing.length) {
        throw new ValidationError({
          "target.resourceIds":
            missing.length === 1
              ? "A selected item no longer exists. Remove it and try again."
              : `${missing.length} selected items no longer exist. Remove them and try again.`,
        });
      }

      return nodes.map(toTargetResource);
    },
  };
}
