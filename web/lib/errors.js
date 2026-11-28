/**
 * Errors that map to a specific HTTP response. Anything else that reaches the
 * error handler is treated as an unexpected 500 and its details are not exposed.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code Machine-readable error code, e.g. "TIMER_NOT_FOUND"
   * @param {string} message Merchant-safe message
   * @param {{ fields?: Record<string, string>, headers?: Record<string, string> }} [options]
   */
  constructor(status, code, message, { fields, headers } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
}

export class ValidationError extends HttpError {
  /** @param {Record<string, string>} fields Field path -> error message */
  constructor(fields, message = "Some fields need your attention.") {
    super(422, "VALIDATION_FAILED", message, { fields });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found.") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

/** Raised when a call to the Shopify Admin API fails (502) or times out (504). */
export class UpstreamError extends HttpError {
  constructor({ timedOut = false } = {}) {
    super(
      timedOut ? 504 : 502,
      timedOut ? "SHOPIFY_TIMEOUT" : "SHOPIFY_REQUEST_FAILED",
      timedOut
        ? "Shopify took too long to respond. Please try again."
        : "Couldn’t reach Shopify. Please try again.",
    );
    this.name = "UpstreamError";
  }
}
