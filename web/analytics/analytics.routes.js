import { Router } from "express";

import { asyncHandler } from "../middleware/http.js";

/**
 * Analytics for the home page, mounted at /api/analytics:
 *
 * - GET /   Impressions in the last 30 days and the 30 days before, the
 *           shop's timers by kind, and the Timer block's status
 *
 * @param {{
 *   analyticsService: ReturnType<typeof import("./analytics.service.js").createAnalyticsService>,
 *   timerService: ReturnType<typeof import("../timers/timer.service.js").createTimerService>,
 * }} deps
 */
export function createAnalyticsRouter({ analyticsService, timerService }) {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const session = res.locals.shopify.session;
      const [summary, timers] = await Promise.all([
        analyticsService.summary(session.shop),
        timerService.counts(session),
      ]);
      res.json({ ...summary, timers });
    }),
  );

  return router;
}
