import { readFileSync } from "node:fs";
import { join } from "node:path";

import compression from "compression";
import express from "express";
import serveStatic from "serve-static";

import { createApiRouter } from "./api/router.js";
import { fallbackErrorHandler } from "./middleware/errors.js";
import { healthRouter } from "./middleware/health.js";
import { createRateLimiters } from "./middleware/rate-limit.js";
import { closeConnectionsWhenStopping, requestContext } from "./middleware/request-context.js";
import { securityHeaders } from "./middleware/security.js";
import { createPrivacyWebhookHandlers } from "./privacy.js";
import { createStorefrontRouter } from "./storefront/storefront.routes.js";

/**
 * Serves the single-page app's HTML with the API key injected. In production
 * the file is read once at startup (a missing build fails fast); in development
 * it's read per request so edits show up.
 */
function appShell({ staticPath, apiKey, cacheHtml }) {
  const render = () =>
    readFileSync(join(staticPath, "index.html"), "utf8").replace("%VITE_SHOPIFY_API_KEY%", apiKey);
  const cached = cacheHtml ? render() : null;

  return (_req, res) => {
    res
      .status(200)
      // The page embeds per-shop CSP and must be re-fetched on every load.
      .set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      .send(cached ?? render());
  };
}

/**
 * Builds the Express application. All I/O dependencies are injected so the
 * same pipeline runs in production and in tests.
 *
 * Middleware order matters:
 * 1. request context (request ID + access log), shutdown handling and security
 *    headers, so every response (including errors and probes) gets them;
 * 2. health probes, before auth, rate limits and compression;
 * 3. compression;
 * 4. Shopify OAuth and webhooks (webhooks read the raw body, so no JSON parser
 *    runs before them);
 * 5. the storefront API, which Shopify's app proxy authenticates by signature
 *    (it's mounted before the session check below and answers every request);
 * 6. the authenticated JSON API;
 * 7. the app shell and static assets;
 * 8. a last-resort error handler.
 *
 * @param {{
 *   config: ReturnType<typeof import("./config.js").loadConfig>,
 *   logger: import("pino").Logger,
 *   shopify: ReturnType<typeof import("./shopify.js").createShopify>,
 *   timerService: ReturnType<typeof import("./timers/timer.service.js").createTimerService>,
 *   storefrontTimers: ReturnType<typeof import("./storefront/storefront-timers.js").createStorefrontTimers>,
 *   lifecycle: ReturnType<typeof import("./lib/lifecycle.js").createLifecycle>,
 *   readinessChecks: Record<string, () => Promise<unknown>>,
 * }} deps
 */
export function createApp({
  config,
  logger,
  shopify,
  timerService,
  storefrontTimers,
  lifecycle,
  readinessChecks,
}) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.server.trustProxy);
  // Parse query strings into flat key/value pairs only (no nested objects).
  app.set("query parser", "simple");

  app.use(requestContext({ logger }));
  app.use(closeConnectionsWhenStopping(lifecycle));
  app.use(securityHeaders({ isProduction: config.isProduction }));
  app.use(healthRouter({ lifecycle, checks: readinessChecks }));
  app.use(compression());

  const limiters = createRateLimiters({ ...config.rateLimit, logger });

  // Shopify OAuth. Rate-limited per IP because these run before a session exists.
  app.get(shopify.config.auth.path, limiters.auth, shopify.auth.begin());
  app.get(
    shopify.config.auth.callbackPath,
    limiters.auth,
    shopify.auth.callback(),
    shopify.redirectToShopifyOrAppRoot(),
  );

  // Webhooks. The library verifies each request's HMAC before calling handlers.
  app.post(
    shopify.config.webhooks.path,
    shopify.processWebhooks({
      webhookHandlers: createPrivacyWebhookHandlers({ timerService, logger }),
    }),
  );

  // Storefront widget API, reached through the app proxy (see shopify.app.toml).
  app.use(
    "/api/storefront",
    createStorefrontRouter({
      storefrontTimers,
      validateSignature: (query) => shopify.api.utils.validateHmac(query, { signator: "appProxy" }),
      limiter: limiters.storefront,
    }),
  );

  // Authenticated JSON API.
  app.use("/api/*", shopify.validateAuthenticatedSession());
  app.use(
    "/api",
    createApiRouter({ timerService, limiters, jsonBodyLimit: config.server.jsonBodyLimit }),
  );

  // App shell. If you add routes outside /api, add a proxy rule for them in
  // web/frontend/vite.config.js too.
  app.use(shopify.cspHeaders());
  if (config.isProduction) {
    const { staticPath } = config.server;
    // Vite fingerprints everything under /assets, so it can be cached forever.
    app.use(
      "/assets",
      serveStatic(join(staticPath, "assets"), { index: false, immutable: true, maxAge: "1y" }),
    );
    app.use(serveStatic(staticPath, { index: false, maxAge: "1h" }));
  }
  app.get(
    "/*",
    shopify.ensureInstalledOnShop(),
    appShell({
      staticPath: config.server.staticPath,
      apiKey: config.shopify.apiKey,
      cacheHtml: config.isProduction,
    }),
  );

  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });
  app.use(fallbackErrorHandler);

  return app;
}
