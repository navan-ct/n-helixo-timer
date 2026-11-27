import { LATEST_API_VERSION, LogSeverity } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";

const PINO_LEVEL = {
  [LogSeverity.Error]: "error",
  [LogSeverity.Warning]: "warn",
  [LogSeverity.Info]: "info",
  [LogSeverity.Debug]: "debug",
};

/**
 * Configures the Shopify app (OAuth, session tokens, webhooks, Admin API
 * clients) from validated config, and routes the library's own logs through
 * the app logger.
 *
 * @param {{
 *   config: ReturnType<typeof import("./config.js").loadConfig>,
 *   sessionStorage: import("@shopify/shopify-app-session-storage").SessionStorage,
 *   logger: import("pino").Logger,
 * }} deps
 */
export function createShopify({ config, sessionStorage, logger }) {
  const log = logger.child({ component: "shopify" });

  return shopifyApp({
    api: {
      apiKey: config.shopify.apiKey,
      apiSecretKey: config.shopify.apiSecret,
      scopes: config.shopify.scopes,
      hostScheme: config.shopify.hostScheme,
      hostName: config.shopify.hostName,
      apiVersion: LATEST_API_VERSION,
      future: {
        customerAddressDefaultFix: true,
        lineItemBilling: true,
        unstable_managedPricingSupport: true,
      },
      billing: undefined, // See https://shopify.dev/docs/apps/launch/billing to charge merchants
      logger: {
        level: config.isProduction ? LogSeverity.Info : LogSeverity.Debug,
        httpRequests: false,
        timestamps: false,
        log: (severity, message) => log[PINO_LEVEL[severity] ?? "info"](message),
      },
    },
    auth: {
      path: "/api/auth",
      callbackPath: "/api/auth/callback",
    },
    webhooks: {
      path: "/api/webhooks",
    },
    sessionStorage,
  });
}
