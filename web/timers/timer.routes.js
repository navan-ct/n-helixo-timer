import { Router } from "express";

import { asyncHandler, requireJson } from "../middleware/http.js";

import { listQuerySchema, parseOrThrow, timerInputSchema } from "./timer.validation.js";

const sessionOf = (res) => res.locals.shopify.session;

/**
 * REST endpoints for timers, mounted at /api/timers:
 *
 * - GET    /           List timers (query, status, sort, page)
 * - POST   /           Create a timer
 * - GET    /:id        Fetch one timer
 * - PUT    /:id        Replace a timer
 * - DELETE /:id        Delete a timer
 *
 * @param {{ timerService: ReturnType<typeof import("./timer.service.js").createTimerService> }} deps
 */
export function createTimerRouter({ timerService }) {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(listQuerySchema, req.query);
      res.json(await timerService.list(sessionOf(res), query));
    }),
  );

  router.post(
    "/",
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(timerInputSchema, req.body);
      const timer = await timerService.create(sessionOf(res), input);
      res.status(201).location(`${req.baseUrl}/${timer.id}`).json({ timer });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      res.json({ timer: await timerService.get(sessionOf(res), req.params.id) });
    }),
  );

  router.put(
    "/:id",
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(timerInputSchema, req.body);
      res.json({ timer: await timerService.update(sessionOf(res), req.params.id, input) });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await timerService.remove(sessionOf(res), req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
