import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

const REQUIRED = {
  NODE_ENV: "production",
  MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net/",
  SHOPIFY_API_KEY: "key",
  SHOPIFY_API_SECRET: "secret",
  SCOPES: "read_products, write_products",
  HOST: "https://timer.example.com",
};

describe("loadConfig", () => {
  it("builds typed config with production defaults", () => {
    const config = loadConfig(REQUIRED);

    expect(config).toMatchObject({
      env: "production",
      isProduction: true,
      server: {
        port: 3000,
        trustProxy: ["loopback", "linklocal", "uniquelocal"],
        keepAliveTimeoutMs: 65_000,
        headersTimeoutMs: 66_000,
        requestTimeoutMs: 30_000,
        shutdownTimeoutMs: 15_000,
        shutdownDelayMs: 5_000,
      },
      shopify: {
        apiKey: "key",
        apiSecret: "secret",
        scopes: ["read_products", "write_products"],
        hostScheme: "https",
        hostName: "timer.example.com",
      },
      mongo: { dbName: "n_helixo_timer", maxPoolSize: 20 },
      log: { level: "info", pretty: false },
      rateLimit: { windowMs: 60_000, max: 120, writeMax: 30, authMax: 30 },
    });
    expect(config.server.staticPath).toMatch(/frontend\/dist\/$/);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("prefers BACKEND_PORT (set by the Shopify CLI) over PORT", () => {
    expect(loadConfig({ ...REQUIRED, PORT: "8081" }).server.port).toBe(8081);
    expect(loadConfig({ ...REQUIRED, PORT: "8081", BACKEND_PORT: "50000" }).server.port).toBe(
      50000,
    );
  });

  it.each([
    ["true", true],
    ["false", false],
    ["2", 2],
    ["10.0.0.0/8, loopback", ["10.0.0.0/8", "loopback"]],
  ])("parses TRUST_PROXY=%j", (value, expected) => {
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY: value }).server.trustProxy).toEqual(expected);
  });

  it("only delays shutdown for load balancer deregistration in production", () => {
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "development" }).server.shutdownDelayMs).toBe(0);
    expect(loadConfig({ ...REQUIRED, SHUTDOWN_DELAY_MS: "2000" }).server.shutdownDelayMs).toBe(
      2000,
    );
    expect(() =>
      loadConfig({ ...REQUIRED, SHUTDOWN_DELAY_MS: "20000", SHUTDOWN_TIMEOUT_MS: "15000" }),
    ).toThrow(/SHUTDOWN_DELAY_MS must be shorter/);
  });

  it("uses readable development logging by default", () => {
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "development" }).log).toEqual({
      level: "debug",
      pretty: true,
    });
    expect(loadConfig({ ...REQUIRED, LOG_LEVEL: "warn" }).log).toEqual({
      level: "warn",
      pretty: false,
    });
  });

  it("doesn't require Shopify credentials in tests", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", MONGODB_URI: "mongodb://localhost/" }),
    ).not.toThrow();
  });

  it("reports every problem at once", () => {
    let error;
    try {
      loadConfig({ PORT: "http", LOG_LEVEL: "loud", HOST: "timer.example.com" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    for (const key of [
      "PORT",
      "LOG_LEVEL",
      "MONGODB_URI",
      "SHOPIFY_API_KEY",
      "SHOPIFY_API_SECRET",
      "SCOPES",
    ]) {
      expect(error.message).toContain(`- ${key}:`);
    }
  });

  it("validates formats", () => {
    expect(() => loadConfig({ ...REQUIRED, MONGODB_URI: "postgres://db" })).toThrow(
      /MONGODB_URI must start with mongodb/,
    );
    expect(() => loadConfig({ ...REQUIRED, HOST: "https://timer.example.com/app" })).toThrow(
      /HOST must be the app's origin/,
    );
    expect(() => loadConfig({ ...REQUIRED, SHUTDOWN_TIMEOUT_MS: "10" })).toThrow(
      /SHUTDOWN_TIMEOUT_MS/,
    );
  });
});
