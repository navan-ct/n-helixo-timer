import express, { Router } from "express";

import { createAnalyticsRouter } from "../analytics/analytics.routes.js";
import { apiErrorHandler, apiNotFound } from "../middleware/errors.js";
import { noStore } from "../middleware/http.js";
import { apiContentSecurityPolicy } from "../middleware/security.js";
import { createTimerRouter } from "../timers/timer.routes.js";

/**
 * The authenticated JSON API. Mount it after
 * `shopify.validateAuthenticatedSession()` so `res.locals.shopify.session` is set.
 *
 * @param {{
 *   timerService: ReturnType<typeof import("../timers/timer.service.js").createTimerService>,
 *   analyticsService: ReturnType<typeof import("../analytics/analytics.service.js").createAnalyticsService>,
 *   limiters: ReturnType<typeof import("../middleware/rate-limit.js").createRateLimiters>,
 *   jsonBodyLimit: string,
 * }} deps
 */
export function createApiRouter({ timerService, analyticsService, limiters, jsonBodyLimit }) {
  const router = Router();

  router.use(noStore, apiContentSecurityPolicy);
  // Rate limits run before body parsing so rejected requests cost as little as possible.
  router.use(limiters.api, limiters.apiWrites);
  router.use(express.json({ limit: jsonBodyLimit, strict: true }));

  router.use("/timers", createTimerRouter({ timerService }));
  router.use("/analytics", createAnalyticsRouter({ analyticsService, timerService }));

  router.use(apiNotFound);
  router.use(apiErrorHandler);

  return router;
}
