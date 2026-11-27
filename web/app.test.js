import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLifecycle } from "./lib/lifecycle.js";
import { silentLogger as logger } from "./lib/logger.js";
import { createFakeShopify, SHOP } from "./test/helpers.js";

const staticPath = mkdtempSync(join(tmpdir(), "timer-app-"));
writeFileSync(
  join(staticPath, "index.html"),
  '<html><head><meta name="shopify-api-key" content="%VITE_SHOPIFY_API_KEY%" /></head></html>',
);
mkdirSync(join(staticPath, "assets"));
writeFileSync(join(staticPath, "assets", "index-abc123.js"), "console.log('app');");

function buildConfig({ production = false, rateLimit = {} } = {}) {
  const base = loadConfig({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://localhost/",
    SHOPIFY_API_KEY: "test-api-key",
  });
  return {
    ...base,
    isProduction: production,
    server: { ...base.server, staticPath },
    rateLimit: { ...base.rateLimit, ...rateLimit },
  };
}

function buildApp({ production, rateLimit, timerService, readinessChecks, shopify } = {}) {
  const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit: vi.fn() });
  const app = createApp({
    config: buildConfig({ production, rateLimit }),
    logger,
    shopify: shopify ?? createFakeShopify(),
    lifecycle,
    readinessChecks: readinessChecks ?? { database: async () => {} },
    timerService: timerService ?? {
      list: vi.fn(async () => ({ timers: [], pageInfo: {}, timezone: "UTC" })),
      removeAllForShop: vi.fn(),
    },
  });
  return { app, lifecycle };
}

describe("health probes", () => {
  it("reports liveness without checking dependencies", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("db down"));
    const { app } = buildApp({ readinessChecks: { database: failing } });

    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(failing).not.toHaveBeenCalled();
  });

  it("is not ready until startup finishes", async () => {
    const { app, lifecycle } = buildApp();
    expect((await request(app).get("/readyz")).status).toBe(503);

    lifecycle.markReady();
    const response = await request(app).get("/readyz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  it("reports failing dependencies without leaking details", async () => {
    const { app, lifecycle } = buildApp({
      readinessChecks: {
        database: async () => {},
        sessionStorage: async () => {
          throw new Error("mongodb://user:secret@host refused");
        },
      },
    });
    lifecycle.markReady();

    const response = await request(app).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "unavailable",
      checks: { database: "ok", sessionStorage: "failing" },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("fails readiness and closes connections while shutting down", async () => {
    const { app, lifecycle } = buildApp();
    lifecycle.markReady();
    lifecycle.shutdown({ reason: "test" });

    const response = await request(app).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "stopping" });
    expect(response.headers.connection).toBe("close");
  });
});

describe("request context", () => {
  it("echoes a valid upstream request ID", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/healthz").set("X-Request-Id", "req-1234abcd");
    expect(response.headers["x-request-id"]).toBe("req-1234abcd");
  });

  it("replaces missing or malformed request IDs", async () => {
    const { app } = buildApp();
    const generated = await request(app).get("/healthz");
    const replaced = await request(app).get("/healthz").set("X-Request-Id", "<script>");

    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security", () => {
  it("sets baseline security headers and hides the framework", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/healthz");

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["x-frame-options"]).toBeUndefined();
  });

  it("only sends HSTS in production", async () => {
    const dev = await request(buildApp().app).get("/healthz");
    const prod = await request(buildApp({ production: true }).app).get("/healthz");

    expect(dev.headers["strict-transport-security"]).toBeUndefined();
    expect(prod.headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("locks down API responses", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/api/timers").set("x-test-shop", SHOP);

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("requires an authenticated session for the API", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/api/timers")).status).toBe(401);
  });

  it("parses query strings flat, so operator objects can't reach handlers", async () => {
    const timerService = { list: vi.fn() };
    const { app } = buildApp({ timerService });

    const response = await request(app).get("/api/timers?query[$ne]=x").set("x-test-shop", SHOP);

    expect(response.status).toBe(422);
    expect(timerService.list).not.toHaveBeenCalled();
  });

  it("rate-limits OAuth endpoints per IP", async () => {
    const { app } = buildApp({ rateLimit: { authMax: 2 } });

    expect((await request(app).get("/api/auth?shop=a.myshopify.com")).status).toBe(302);
    expect((await request(app).get("/api/auth?shop=a.myshopify.com")).status).toBe(302);
    const limited = await request(app).get("/api/auth?shop=a.myshopify.com");

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
  });
});

describe("API errors", () => {
  it("returns JSON 404s for unknown API routes", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/api/nope").set("x-test-shop", SHOP);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "ROUTE_NOT_FOUND" });
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("hides internal errors", async () => {
    const timerService = { list: vi.fn().mockRejectedValue(new Error("password=hunter2")) };
    const { app } = buildApp({ timerService });

    const response = await request(app).get("/api/timers").set("x-test-shop", SHOP);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.text).not.toContain("hunter2");
  });
});

describe("compression", () => {
  it("compresses large responses", async () => {
    const timers = Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `Timer ${i}` }));
    const timerService = { list: vi.fn(async () => ({ timers, pageInfo: {}, timezone: "UTC" })) };
    const { app } = buildApp({ timerService });

    const response = await request(app)
      .get("/api/timers")
      .set("x-test-shop", SHOP)
      .set("Accept-Encoding", "gzip");

    expect(response.headers["content-encoding"]).toBe("gzip");
  });
});

describe("app shell", () => {
  it("serves the SPA with the API key and Shopify's frame-ancestors policy", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/?shop=a.myshopify.com&host=abc");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors");
    expect(response.text).toContain('content="test-api-key"');
  });

  it("serves fingerprinted assets with long-lived caching in production", async () => {
    const { app } = buildApp({ production: true });
    const response = await request(app).get("/assets/index-abc123.js");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("returns 404 for non-GET requests outside the API", async () => {
    const { app } = buildApp();
    expect((await request(app).post("/anything")).status).toBe(404);
  });

  it("answers failures outside the API with a reference, not a stack trace", async () => {
    const shopify = createFakeShopify();
    shopify.ensureInstalledOnShop = () => () => {
      throw new Error("internal detail");
    };
    const { app } = buildApp({ shopify });

    const response = await request(app).get("/");

    expect(response.status).toBe(500);
    expect(response.text).toBe(
      `Something went wrong. Reference: ${response.headers["x-request-id"]}`,
    );
  });

  it("rejects malformed URLs", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/api/timers/%E0%A4%A").set("x-test-shop", SHOP);
    expect([400, 404]).toContain(response.status);
  });
});

describe("webhooks", () => {
  let shopify;

  beforeEach(() => {
    shopify = createFakeShopify();
    shopify.processWebhooks = vi.fn(() => (_req, res) => res.status(200).end());
  });

  it("registers the privacy handlers with the webhook processor", async () => {
    const { app } = buildApp({ shopify });
    expect((await request(app).post("/api/webhooks").send("{}")).status).toBe(200);
    const [{ webhookHandlers }] = shopify.processWebhooks.mock.calls[0];
    expect(Object.keys(webhookHandlers)).toEqual([
      "CUSTOMERS_DATA_REQUEST",
      "CUSTOMERS_REDACT",
      "SHOP_REDACT",
    ]);
  });
});
