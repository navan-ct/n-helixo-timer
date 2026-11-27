import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import { HttpError } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The authenticated shop, or the client IP (with IPv6 subnet grouping) when unauthenticated. */
function shopOrIp(req, res) {
  return res.locals.shopify?.session?.shop ?? ipKeyGenerator(req.ip ?? "unknown");
}

function rateLimited(windowMs) {
  return (_req, _res, next) => {
    next(
      new HttpError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.", {
        headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) },
      }),
    );
  };
}

/**
 * Builds the app's rate limiters:
 * - `api`: every authenticated API call, per shop.
 * - `apiWrites`: a stricter budget for mutations, per shop.
 * - `auth`: OAuth endpoints, per client IP (they run before a session exists).
 *
 * Counters are kept in memory, per process. If the app runs on several
 * instances, pass a shared store to each limiter (for example `rate-limit-redis`)
 * so the limits apply across all of them.
 *
 * @param {{
 *   windowMs: number, max: number, writeMax: number, authMax: number,
 *   logger: import("pino").Logger,
 * }} options
 */
export function createRateLimiters({ windowMs, max, writeMax, authMax, logger }) {
  const log = logger.child({ component: "rate-limit" });
  const common = {
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: rateLimited(windowMs),
    // Route express-rate-limit's misconfiguration warnings to the app logger.
    logger: { warn: (message) => log.warn(message), error: (message) => log.error(message) },
  };

  return {
    api: rateLimit({ ...common, limit: max, keyGenerator: shopOrIp }),
    apiWrites: rateLimit({
      ...common,
      limit: writeMax,
      skip: (req) => SAFE_METHODS.has(req.method),
      keyGenerator: shopOrIp,
    }),
    auth: rateLimit({ ...common, limit: authMax }),
  };
}
