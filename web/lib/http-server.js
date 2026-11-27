import http from "node:http";

/**
 * Creates an HTTP server for `app` with production timeouts:
 * - keepAliveTimeout above the load balancer's idle timeout, so the balancer
 *   (not Node) closes idle connections and never sends a request to a socket
 *   Node just closed;
 * - headersTimeout above keepAliveTimeout, as Node requires;
 * - requestTimeout to cut off slow or stalled requests.
 *
 * @param {import("express").Express} app
 * @param {{ keepAliveTimeoutMs: number, headersTimeoutMs: number, requestTimeoutMs: number }} timeouts
 */
export function createHttpServer(app, { keepAliveTimeoutMs, headersTimeoutMs, requestTimeoutMs }) {
  const server = http.createServer(app);
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  return server;
}

/** Starts listening and resolves once the port is bound (rejects on errors such as EADDRINUSE). */
export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server.address());
    });
  });
}

/**
 * Stops accepting connections and waits for in-flight requests to finish.
 * Idle keep-alive sockets are closed right away; any request still running
 * after `drainTimeoutMs` has its socket destroyed.
 *
 * @returns {Promise<{ forced: boolean }>}
 */
export function closeServer(server, { drainTimeoutMs, pollIntervalMs = 100 }) {
  if (!server.listening) return Promise.resolve({ forced: false });

  return new Promise((resolve, reject) => {
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      server.closeAllConnections();
    }, drainTimeoutMs);
    // Requests that were in flight leave keep-alive sockets behind when they
    // finish; close those as they become idle instead of waiting out the
    // keep-alive timeout.
    const idleTimer = setInterval(() => server.closeIdleConnections(), pollIntervalMs);
    forceTimer.unref?.();
    idleTimer.unref?.();

    server.close((error) => {
      clearTimeout(forceTimer);
      clearInterval(idleTimer);
      if (error) reject(error);
      else resolve({ forced });
    });
    server.closeIdleConnections();
  });
}
