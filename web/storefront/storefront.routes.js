import { Router } from "express";
import { z } from "zod";

import { apiErrorHandler, apiNotFound } from "../middleware/errors.js";
import { asyncHandler } from "../middleware/http.js";
import { apiContentSecurityPolicy } from "../middleware/security.js";
import { parseOrThrow } from "../timers/timer.validation.js";

import { verifyAppProxy } from "./app-proxy.js";

/** Liquid exposes numeric resource IDs; Shopify IDs fit in 64 bits. */
const NUMERIC_ID = /^\d{1,20}$/;
const MAX_COLLECTIONS = 250;

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

/**
 * Public, read-only endpoints for the storefront widget, reached through the
 * app proxy (`/apps/<subpath>/*` on the shop's domain is forwarded here).
 *
 * - GET /timers?product=<id>&collections=<id,id>  Timers for one product page
 *
 * Responses are the same for every shopper and carry no customer data. The
 * widget caches them itself, so they're never cached in between (the body
 * includes the server time the widget uses to correct the shopper's clock).
 *
 * @param {{
 *   storefrontTimers: ReturnType<typeof import("./storefront-timers.js").createStorefrontTimers>,
 *   validateSignature: (query: Record<string, string | string[]>) => Promise<boolean>,
 *   limiter: import("express").RequestHandler,
 * }} deps
 */
export function createStorefrontRouter({ storefrontTimers, validateSignature, limiter }) {
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

  router.use(apiNotFound);
  router.use(apiErrorHandler);

  return router;
}
