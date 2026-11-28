import { DeliveryMethod } from "@shopify/shopify-api";

/**
 * Handlers for Shopify's mandatory privacy webhooks.
 * https://shopify.dev/docs/apps/build/privacy-law-compliance
 *
 * The app stores timer settings and anonymous daily impression counts per
 * shop, and no customer data, so only `shop/redact` has anything to erase.
 *
 * @param {{
 *   timerService: { removeAllForShop: (shop: string) => Promise<number> },
 *   analyticsService: { removeAllForShop: (shop: string) => Promise<number> },
 *   logger: import("pino").Logger,
 * }} deps
 * @returns {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export function createPrivacyWebhookHandlers({ timerService, analyticsService, logger }) {
  const log = logger.child({ component: "privacy-webhooks" });
  return {
    /**
     * Customers can request their data from a store owner.
     * https://shopify.dev/docs/apps/build/privacy-law-compliance#customers-data_request
     */
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: async (topic, shop) => {
        log.info({ topic, shop }, "Privacy webhook received; no customer data is stored");
      },
    },

    /**
     * Store owners can request deletion of a customer's data.
     * https://shopify.dev/docs/apps/build/privacy-law-compliance#customers-redact
     */
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: async (topic, shop) => {
        log.info({ topic, shop }, "Privacy webhook received; no customer data is stored");
      },
    },

    /**
     * Sent 48 hours after a store uninstalls the app: erase all of the shop's data.
     * https://shopify.dev/docs/apps/build/privacy-law-compliance#shop-redact
     */
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: async (topic, shop) => {
        const [deletedTimers, deletedImpressions] = await Promise.all([
          timerService.removeAllForShop(shop),
          analyticsService.removeAllForShop(shop),
        ]);
        log.info({ topic, shop, deletedTimers, deletedImpressions }, "Erased shop data");
      },
    },
  };
}
