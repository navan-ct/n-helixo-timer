import mongoose from "mongoose";

import { HttpError } from "../lib/errors.js";

/**
 * Maps known error types to HTTP errors. Returns null for unexpected errors,
 * which become a generic 500 so internals never reach the client.
 */
export function toHttpError(error) {
  if (error instanceof HttpError) return error;

  // body-parser / raw-body
  switch (error?.type) {
    case "entity.parse.failed":
      return new HttpError(400, "INVALID_JSON", "The request body isn't valid JSON.");
    case "entity.too.large":
      return new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    case "encoding.unsupported":
    case "charset.unsupported":
      return new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as UTF-8 JSON.");
    case "request.aborted":
      return new HttpError(400, "REQUEST_ABORTED", "The request was aborted.");
    default:
      break;
  }

  // Malformed percent-encoding in the URL.
  if (error instanceof URIError) {
    return new HttpError(400, "MALFORMED_URL", "The request URL is malformed.");
  }

  if (error instanceof mongoose.Error.VersionError) {
    return new HttpError(
      409,
      "EDIT_CONFLICT",
      "This timer was changed somewhere else. Reload the page and try again.",
    );
  }

  return null;
}

/** 404 for unknown API routes, in the API's JSON error format. */
export function apiNotFound(_req, _res, next) {
  next(new HttpError(404, "ROUTE_NOT_FOUND", "This API route doesn't exist."));
}

/**
 * Final error handler for the JSON API.
 *
 * Response shape: `{ error: { code, message, fields?, requestId } }`.
 * Server errors are logged with the request ID; client errors are already
 * captured by the access log at warn level.
 */
// Express recognizes error handlers by their four-argument signature.
export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const known = toHttpError(error);
  const status = known?.status ?? 500;
  if (status >= 500) {
    req.log.error({ err: error }, "Request failed");
  }

  if (known?.headers) res.set(known.headers);
  res.status(status).json({
    error: {
      code: known?.code ?? "INTERNAL_ERROR",
      message: known?.message ?? "Something went wrong on our end. Try again in a moment.",
      ...(known?.fields ? { fields: known.fields } : {}),
      requestId: req.id,
    },
  });
}

/**
 * Last-resort handler for everything outside the API (OAuth, webhooks, the app
 * shell): plain-text responses without internal details.
 */
export function fallbackErrorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const known = toHttpError(error);
  const status = known?.status ?? (Number.isInteger(error?.status) ? error.status : 500);
  if (status >= 500) {
    req.log.error({ err: error }, "Request failed");
  }

  res
    .status(status)
    .type("text/plain")
    .send(
      status >= 500
        ? `Something went wrong. Reference: ${req.id}`
        : (known?.message ?? "Bad request"),
    );
}
