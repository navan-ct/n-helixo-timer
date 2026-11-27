import { HttpError } from "../lib/errors.js";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Authenticates requests that Shopify forwards through the app proxy.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 *
 * Shopify signs every proxied request (its query string, including `shop` and
 * `timestamp`) with the app's secret. A valid signature proves the request came
 * through the proxy for that shop; the shop is then trusted and set on
 * `res.locals.storefront.shop`. Anything else gets a 401 without details.
 *
 * @param {{ validateSignature: (query: Record<string, string | string[]>) => Promise<boolean> }} deps
 *   Usually `query => shopify.api.utils.validateHmac(query, { signator: "appProxy" })`,
 *   which also rejects stale timestamps.
 */
export function verifyAppProxy({ validateSignature }) {
  return async (req, res, next) => {
    let valid;
    try {
      valid = typeof req.query.signature === "string" && (await validateSignature(req.query));
    } catch {
      // Missing parameters and expired timestamps throw; treat them like a bad signature.
      valid = false;
    }

    const shop = typeof req.query.shop === "string" ? req.query.shop.toLowerCase() : "";
    if (!valid || !SHOP_DOMAIN.test(shop)) {
      next(new HttpError(401, "INVALID_SIGNATURE", "This request didn't come from Shopify."));
      return;
    }

    res.locals.storefront = { shop };
    next();
  };
}
