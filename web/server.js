import { setTimeout as delay } from "node:timers/promises";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  connectDatabase,
  disconnectDatabase,
  pingDatabase,
  syncModelIndexes,
} from "./db/mongoose.js";
import { closeServer, createHttpServer, listen } from "./lib/http-server.js";
import { createLifecycle } from "./lib/lifecycle.js";
import { createLogger } from "./lib/logger.js";
import { createShopifyAdminApi } from "./shopify/admin-api.js";
import { createSessionStorage } from "./shopify/session-storage.js";
import { createShopify } from "./shopify.js";
import { createStorefrontTimers } from "./storefront/storefront-timers.js";
import { Timer } from "./timers/timer.model.js";
import { createTimerService } from "./timers/timer.service.js";

/**
 * Boots the server: validate config → connect MongoDB → open session storage →
 * build the app → listen. Each resource registers its cleanup as it starts, so
 * a failure at any step (or a later SIGTERM) unwinds exactly what was started.
 */
export async function startServer({ env = process.env } = {}) {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    // The logger isn't configured yet; this is the one place we write to stderr directly.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.log);
  const lifecycle = createLifecycle({ logger, timeoutMs: config.server.shutdownTimeoutMs });
  lifecycle.installProcessHandlers();

  try {
    await connectDatabase({ ...config.mongo, logger });
    lifecycle.onShutdown("mongodb", disconnectDatabase);
    await syncModelIndexes([Timer]);

    const sessions = await createSessionStorage({
      uri: config.mongo.uri,
      dbName: config.mongo.dbName,
      timeoutMs: config.mongo.serverSelectionTimeoutMs,
    });
    lifecycle.onShutdown("session storage", sessions.close);

    const shopify = createShopify({ config, sessionStorage: sessions.storage, logger });
    const adminApi = createShopifyAdminApi({
      createClient: (session) => new shopify.api.clients.Graphql({ session }),
      logger,
      timeoutMs: config.shopify.apiTimeoutMs,
      retries: config.shopify.apiRetries,
    });
    const storefrontTimers = createStorefrontTimers({ Timer });
    const timerService = createTimerService({
      Timer,
      adminApi,
      onChange: (shop) => storefrontTimers.invalidate(shop),
    });

    const app = createApp({
      config,
      logger,
      shopify,
      timerService,
      storefrontTimers,
      lifecycle,
      readinessChecks: { database: () => pingDatabase(), sessionStorage: sessions.ping },
    });

    const server = createHttpServer(app, config.server);
    // Registered last so it runs first: stop taking traffic before closing databases.
    lifecycle.onShutdown("http server", async () => {
      const { shutdownDelayMs, shutdownTimeoutMs } = config.server;
      if (shutdownDelayMs > 0) {
        // Keep serving while /readyz reports 503, so the load balancer
        // deregisters this instance before the listener closes.
        logger.info({ shutdownDelayMs }, "Draining: waiting for load balancer deregistration");
        await delay(shutdownDelayMs);
      }
      // Leave ~3s of the shutdown budget for closing database connections.
      const drainTimeoutMs = Math.max(shutdownTimeoutMs - shutdownDelayMs - 3_000, 1_000);
      const { forced } = await closeServer(server, { drainTimeoutMs });
      if (forced) logger.warn("Closed connections that were still busy after the drain timeout");
    });

    await listen(server, config.server.port);
    lifecycle.markReady();
    logger.info({ port: config.server.port, env: config.env }, "Server ready");
  } catch (error) {
    logger.fatal({ err: error }, "Startup failed");
    await lifecycle.shutdown({ reason: "startup failure", exitCode: 1 });
  }
}
