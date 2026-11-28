import express, { Router } from "express";
import { z } from "zod";

import { apiErrorHandler, apiNotFound } from "../middleware/errors.js";
import { asyncHandler } from "../middleware/http.js";
import { apiContentSecurityPolicy } from "../middleware/security.js";
import { parseOrThrow } from "../timers/timer.validation.js";

import { verifyAppProxy } from "./app-proxy.js";
import { MAX_TIMERS_PER_RESPONSE } from "./storefront-timers.js";

/** Liquid exposes numeric resource IDs; Shopify IDs fit in 64 bits. */
const NUMERIC_ID = /^\d{1,20}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_COLLECTIONS = 250;
/** An impressions report is a short list of timer IDs. */
const IMPRESSIONS_BODY_LIMIT = "2kb";

const timersQuerySchema = z.object({
  product: z.string({ error: "Pass a product ID." }).regex(NUMERIC_ID, {
    error: "The product ID must be numeric.",
  }),
  collections: z
    .string({ error: "Collection IDs must be a comma-separated list." })
    .default("")
    .transform((value) => [...new Set(value.split(",").filter(Boolean))])
    .pipe(
      z
        .array(z.string().regex(NUMERIC_ID, { error: "Collection IDs must be numeric." }))
        .max(MAX_COLLECTIONS, { error: `Pass up to ${MAX_COLLECTIONS} collection IDs.` }),
    ),
});
// Shopify adds its own parameters (shop, signature, timestamp, ...) and may add
// more over time, so unknown keys are ignored rather than rejected.

const impressionsBodySchema = z.object({
  timers: z
    .array(z.string().regex(OBJECT_ID, { error: "Timer IDs must be valid." }), {
      error: "Pass a list of timer IDs.",
    })
    .min(1, { error: "Pass at least one timer ID." })
    // The widget reports the timers it was sent, at most this many per product.
    .max(MAX_TIMERS_PER_RESPONSE, { error: `Pass up to ${MAX_TIMERS_PER_RESPONSE} timer IDs.` })
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});

/**
 * Public endpoints for the storefront widget, reached through the app proxy
 * (`/apps/<subpath>/*` on the shop's domain is forwarded here).
 *
 * - GET  /timers?product=<id>&collections=<id,id>  Timers for one product page
 * - POST /impressions  `{ "timers": ["<id>", ...] }`: the shopper saw these
 *   timers. Counted anonymously; IDs that aren't the shop's viewable timers
 *   are ignored. Answers 204.
 *
 * Responses are the same for every shopper and carry no customer data. The
 * widget caches them itself, so they're never cached in between (the body
 * includes the server time the widget uses to correct the shopper's clock).
 *
 * @param {{
 *   storefrontTimers: ReturnType<typeof import("./storefront-timers.js").createStorefrontTimers>,
 *   impressions: Pick<ReturnType<typeof import("../analytics/impression-recorder.js").createImpressionRecorder>,
 *     "recordImpressions">,
 *   validateSignature: (query: Record<string, string | string[]>) => Promise<boolean>,
 *   limiter: import("express").RequestHandler,
 * }} deps
 */
export function createStorefrontRouter({
  storefrontTimers,
  impressions,
  validateSignature,
  limiter,
}) {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  }, apiContentSecurityPolicy);
  router.use(verifyAppProxy({ validateSignature }));
  router.use(limiter);

  router.get(
    "/timers",
    asyncHandler(async (req, res) => {
      const { product, collections } = parseOrThrow(timersQuerySchema, {
        product: req.query.product,
        collections: req.query.collections,
      });
      res.json(
        await storefrontTimers.forProduct(res.locals.storefront.shop, {
          productId: product,
          collectionIds: collections,
        }),
      );
    }),
  );

  router.post(
    "/impressions",
    // `navigator.sendBeacon` sends a string body as text/plain, so accept that too.
    express.json({
      limit: IMPRESSIONS_BODY_LIMIT,
      strict: true,
      type: ["application/json", "text/plain"],
    }),
    asyncHandler(async (req, res) => {
      const { timers } = parseOrThrow(impressionsBodySchema, req.body ?? {});
      const { shop } = res.locals.storefront;
      const viewable = await storefrontTimers.filterViewable(shop, timers);
      if (viewable.length) impressions.recordImpressions(shop, viewable);
      res.status(204).end();
    }),
  );

  router.use(apiNotFound);
  router.use(apiErrorHandler);

  return router;
}
