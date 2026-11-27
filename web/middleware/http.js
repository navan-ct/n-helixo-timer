import { HttpError } from "../lib/errors.js";

/** Express 4 doesn't forward rejected promises to error handlers; this does. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/** Rejects write requests that don't declare a JSON body. */
export function requireJson(req, _res, next) {
  if (!req.is("application/json")) {
    next(new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as JSON."));
    return;
  }
  next();
}

/** Responses that contain per-merchant data must never be cached. */
export function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}
