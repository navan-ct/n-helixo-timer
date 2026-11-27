import { randomUUID } from "node:crypto";

import { pinoHttp } from "pino-http";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;
const PROBE_PATHS = new Set(["/healthz", "/readyz"]);

const pathOf = (req) => (req.originalUrl ?? req.url ?? "").split("?")[0];

/**
 * Per-request context: a request ID (reusing a well-formed upstream
 * `X-Request-Id`, echoed back on the response) and a request-scoped logger at
 * `req.log` that writes one access-log line when the response finishes.
 *
 * Only the method and path are logged. Query strings carry OAuth codes, HMACs
 * and session tokens in Shopify flows, and headers carry bearer tokens.
 *
 * @param {{ logger: import("pino").Logger }} options
 */
export function requestContext({ logger }) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers[REQUEST_ID_HEADER];
      const id =
        typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    customProps: (_req, res) => {
      const shop = res.locals?.shopify?.session?.shop;
      return shop ? { shop } : {};
    },
    // Health probes run every few seconds; keep them out of the access log.
    autoLogging: { ignore: (req) => PROBE_PATHS.has(pathOf(req)) },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: pathOf(req.raw ?? req) }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    wrapSerializers: false,
  });
}

/**
 * While the process is shutting down, ask clients to drop keep-alive
 * connections so they reconnect to a healthy instance.
 *
 * @param {{ isShuttingDown: () => boolean }} lifecycle
 */
export function closeConnectionsWhenStopping(lifecycle) {
  return (_req, res, next) => {
    if (lifecycle.isShuttingDown()) res.setHeader("Connection", "close");
    next();
  };
}
