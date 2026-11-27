import { Router } from "express";

/**
 * Health probes for load balancers and orchestrators.
 *
 * - `GET /healthz` (liveness): the process is up and serving HTTP. It never
 *   checks dependencies, so a database blip doesn't get the container restarted.
 * - `GET /readyz` (readiness): the instance can serve traffic. It returns 503
 *   while starting, while shutting down (so the balancer drains it), or when a
 *   dependency check fails.
 *
 * Responses name failing checks but never include error details.
 *
 * @param {{
 *   lifecycle: { isReady: () => boolean, state: string },
 *   checks: Record<string, () => Promise<unknown>>,
 *   timeoutMs?: number,
 * }} options
 */
export function healthRouter({ lifecycle, checks, timeoutMs = 2_000 }) {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get("/readyz", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!lifecycle.isReady()) {
      res.status(503).json({ status: lifecycle.state });
      return;
    }

    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        let timer;
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
            }),
          ]);
          return [name, "ok"];
        } catch (error) {
          req.log.warn({ check: name, err: error }, "Readiness check failed");
          return [name, "failing"];
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    const ok = results.every(([, result]) => result === "ok");
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "unavailable",
      checks: Object.fromEntries(results),
    });
  });

  return router;
}
