import { createHmac } from "node:crypto";

import "@shopify/shopify-api/adapters/node";
import { LATEST_API_VERSION, LogSeverity, shopifyApi } from "@shopify/shopify-api";
import express from "express";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApiRouter } from "../api/router.js";
import { connectDatabase, disconnectDatabase, syncModelIndexes } from "../db/mongoose.js";
import { silentLogger } from "../lib/logger.js";
import { createRateLimiters } from "../middleware/rate-limit.js";
import { requestContext } from "../middleware/request-context.js";
import { createShopifyAdminApi } from "../shopify/admin-api.js";
import { createStorefrontTimers } from "../storefront/storefront-timers.js";
import { createStorefrontRouter } from "../storefront/storefront.routes.js";
import { Timer } from "../timers/timer.model.js";
import { createTimerService } from "../timers/timer.service.js";

export const SHOP = "alpha-store.myshopify.com";
export const OTHER_SHOP = "beta-store.myshopify.com";
export const SHOP_TIMEZONE = "America/New_York";
/** Fixed "now" for deterministic tests: 2026-11-27 07:00 in New York. */
export const NOW = new Date("2026-11-27T12:00:00.000Z");

/** Products and collections the fake Admin API knows about. */
export const CATALOG = {
  "gid://shopify/Product/1001": {
    __typename: "Product",
    id: "gid://shopify/Product/1001",
    title: "Snowboard",
    handle: "snowboard",
    featuredMedia: {
      preview: { image: { url: "https://cdn.test/snowboard.png", altText: "Board" } },
    },
  },
  "gid://shopify/Product/1002": {
    __typename: "Product",
    id: "gid://shopify/Product/1002",
    title: "Ski wax",
    handle: "ski-wax",
    featuredMedia: null,
  },
  "gid://shopify/Collection/2001": {
    __typename: "Collection",
    id: "gid://shopify/Collection/2001",
    title: "Winter sale",
    handle: "winter-sale",
    image: { url: "https://cdn.test/winter.png", altText: "" },
  },
};

/** Starts an in-memory MongoDB and connects through the same code path as production. */
export async function startDatabase() {
  const server = await MongoMemoryServer.create();
  await connectDatabase({
    uri: server.getUri(),
    dbName: "timers-test",
    maxPoolSize: 5,
    serverSelectionTimeoutMs: 5_000,
    logger: silentLogger,
  });
  await syncModelIndexes([Timer]);
  return async () => {
    await disconnectDatabase();
    await server.stop();
  };
}

/** A stand-in for the Admin GraphQL client that answers from CATALOG. */
export function createFakeGraphqlClient({ timezone = SHOP_TIMEZONE, fail = false } = {}) {
  const request = async (query, options) => {
    if (fail) throw new Error("Network down");
    if (query.includes("ShopTimezone")) {
      return { data: { shop: { ianaTimezone: timezone } } };
    }
    if (query.includes("TimerTargetResources")) {
      return { data: { nodes: options.variables.ids.map((id) => CATALOG[id] ?? null) } };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  return { request };
}

/**
 * Builds an Express app that mounts the real API router behind a fake auth
 * middleware. Requests authenticate as the shop in the `x-test-shop` header.
 */
export const TEST_RATE_LIMITS = {
  windowMs: 60_000,
  max: 10_000,
  writeMax: 10_000,
  authMax: 10_000,
  storefrontMax: 10_000,
};

export function buildTestApp({
  now = () => NOW,
  graphql = createFakeGraphqlClient(),
  rateLimit = TEST_RATE_LIMITS,
  timerService: overrideService,
} = {}) {
  const adminApi = createShopifyAdminApi({ createClient: () => graphql, logger: silentLogger });
  const timerService = overrideService ?? createTimerService({ Timer, adminApi, now });
  const limiters = createRateLimiters({ ...TEST_RATE_LIMITS, ...rateLimit, logger: silentLogger });

  const app = express();
  app.set("query parser", "simple");
  app.use(requestContext({ logger: silentLogger }));
  app.use((req, res, next) => {
    res.locals.shopify = { session: { shop: req.get("x-test-shop") ?? SHOP } };
    next();
  });
  app.use("/api", createApiRouter({ timerService, limiters, jsonBodyLimit: "16kb" }));
  return { app, timerService };
}

/**
 * A stand-in for the object returned by `shopifyApp()`, for testing the app
 * pipeline without Shopify. Requests authenticate as the shop in `x-test-shop`.
 */
export function createFakeShopify() {
  const passThrough = () => (_req, _res, next) => next();
  const validateProxySignature = createProxySignatureValidator();
  return {
    api: {
      utils: {
        validateHmac: (query, { signator } = {}) =>
          signator === "appProxy" ? validateProxySignature(query) : Promise.resolve(false),
      },
    },
    config: {
      auth: { path: "/api/auth", callbackPath: "/api/auth/callback" },
      webhooks: { path: "/api/webhooks" },
    },
    auth: {
      begin: () => (_req, res) => res.redirect("https://admin.shopify.com/oauth/install"),
      callback: passThrough,
    },
    redirectToShopifyOrAppRoot: () => (_req, res) => res.redirect("/"),
    processWebhooks: () => (_req, res) => res.status(200).end(),
    validateAuthenticatedSession: () => (req, res, next) => {
      const shop = req.get("x-test-shop");
      if (!shop) {
        res.status(401).end();
        return;
      }
      res.locals.shopify = { session: { shop } };
      next();
    },
    cspHeaders: () => (_req, res, next) => {
      res.setHeader("Content-Security-Policy", "frame-ancestors https://admin.shopify.com");
      next();
    },
    ensureInstalledOnShop: passThrough,
  };
}

/** A valid create/update payload; override fields per test. */
export function timerPayload(overrides = {}) {
  return {
    name: "Black Friday Sale",
    description: "50% off all products",
    startDate: "2026-11-29",
    startTime: "00:00",
    endDate: "2026-11-30",
    endTime: "23:59",
    color: "#008060",
    size: "medium",
    position: "top",
    urgency: "color_pulse",
    target: { type: "all", resourceIds: [] },
    ...overrides,
  };
}

/** Inserts a timer directly, bypassing the API. */
export function insertTimer(fields = {}) {
  return Timer.create({
    shop: SHOP,
    name: "Seeded timer",
    description: "",
    startsAt: new Date("2026-11-20T00:00:00Z"),
    endsAt: new Date("2026-12-20T00:00:00Z"),
    timezone: SHOP_TIMEZONE,
    color: "#008060",
    size: "medium",
    position: "top",
    urgency: "none",
    target: { type: "all", resources: [] },
    ...fields,
  });
}

export const API_SECRET = "test-api-secret";

/** Shopify's real app proxy signature check, configured with the test secret. */
export function createProxySignatureValidator(secret = API_SECRET) {
  const api = shopifyApi({
    apiKey: "test-api-key",
    apiSecretKey: secret,
    scopes: [],
    hostName: "localhost",
    hostScheme: "http",
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: true,
    logger: { level: LogSeverity.Error, log: () => {} },
  });
  return (query) => api.utils.validateHmac(query, { signator: "appProxy" });
}

/**
 * Builds the query string Shopify's app proxy would forward: the storefront
 * parameters plus shop, path_prefix, timestamp and a signature over all of them.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 */
export function signedProxyQuery(
  params = {},
  { shop = SHOP, secret = API_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {},
) {
  const query = {
    logged_in_customer_id: "",
    path_prefix: "/apps/n-helixo-timer",
    shop,
    timestamp: String(timestamp),
    ...params,
  };
  const message = Object.keys(query)
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(",") : query[key]}`)
    .join("");
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...query, signature }).toString();
}

/**
 * Mounts the real storefront router (signature check included) next to the
 * admin API, sharing one cache, as in production.
 */
export function buildStorefrontTestApp({ now = () => NOW, rateLimit = TEST_RATE_LIMITS } = {}) {
  const storefrontTimers = createStorefrontTimers({ Timer, now });
  const adminApi = createShopifyAdminApi({
    createClient: () => createFakeGraphqlClient(),
    logger: silentLogger,
  });
  const timerService = createTimerService({
    Timer,
    adminApi,
    now,
    onChange: (shop) => storefrontTimers.invalidate(shop),
  });
  const limiters = createRateLimiters({ ...TEST_RATE_LIMITS, ...rateLimit, logger: silentLogger });

  const app = express();
  app.set("query parser", "simple");
  app.use(requestContext({ logger: silentLogger }));
  app.use(
    "/api/storefront",
    createStorefrontRouter({
      storefrontTimers,
      validateSignature: createProxySignatureValidator(),
      limiter: limiters.storefront,
    }),
  );
  app.use((req, res, next) => {
    res.locals.shopify = { session: { shop: req.get("x-test-shop") ?? SHOP } };
    next();
  });
  app.use("/api", createApiRouter({ timerService, limiters, jsonBodyLimit: "16kb" }));
  return { app, storefrontTimers, timerService };
}
