/**
 * Process lifecycle: readiness state and graceful shutdown.
 *
 * Resources register a cleanup hook as they start; on shutdown the hooks run in
 * reverse order (last started, first stopped), so the HTTP server stops taking
 * traffic and drains before the database connections it depends on are closed.
 * The whole sequence is bounded by a timeout so a stuck hook can't hang a deploy.
 */

const State = Object.freeze({
  STARTING: "starting",
  READY: "ready",
  STOPPING: "stopping",
});

/**
 * @param {{
 *   logger: import("pino").Logger,
 *   timeoutMs: number,
 *   exit?: (code: number) => void,
 * }} options
 */
export function createLifecycle({ logger, timeoutMs, exit = (code) => process.exit(code) }) {
  let state = State.STARTING;
  /** @type {{ name: string, run: () => unknown }[]} */
  const hooks = [];
  let shutdownPromise = null;

  async function runHooks() {
    for (const hook of [...hooks].reverse()) {
      const started = Date.now();
      try {
        // Sequential on purpose: each step depends on the previous one finishing.
        // eslint-disable-next-line no-await-in-loop
        await hook.run();
        logger.info(
          { hook: hook.name, durationMs: Date.now() - started },
          "Shutdown step finished",
        );
      } catch (error) {
        logger.error({ hook: hook.name, err: error }, "Shutdown step failed");
      }
    }
  }

  const lifecycle = {
    get state() {
      return state;
    },
    isReady: () => state === State.READY,
    isShuttingDown: () => state === State.STOPPING,

    markReady() {
      if (state === State.STARTING) state = State.READY;
    },

    /** Registers cleanup to run on shutdown. */
    onShutdown(name, run) {
      hooks.push({ name, run });
    },

    /**
     * Shuts down once; later calls return the same promise.
     * @param {{ reason: string, exitCode?: number }} options
     */
    shutdown({ reason, exitCode = 0 }) {
      if (shutdownPromise) return shutdownPromise;
      state = State.STOPPING;
      logger.info({ reason, timeoutMs }, "Shutting down");

      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        timer.unref?.();
      });

      shutdownPromise = Promise.race([runHooks().then(() => "done"), timeout]).then((outcome) => {
        clearTimeout(timer);
        if (outcome === "timeout") {
          logger.error({ timeoutMs }, "Shutdown timed out; forcing exit");
          exit(1);
          return;
        }
        logger.info({ exitCode }, "Shutdown complete");
        exit(exitCode);
      });
      return shutdownPromise;
    },

    /**
     * Wires OS signals and fatal process errors to a graceful shutdown.
     * A second SIGINT/SIGTERM while stopping forces an immediate exit.
     *
     * @param {NodeJS.EventEmitter} [proc]
     */
    installProcessHandlers(proc = process) {
      for (const signal of ["SIGTERM", "SIGINT"]) {
        proc.on(signal, () => {
          if (state === State.STOPPING) {
            logger.warn({ signal }, "Received second signal; exiting immediately");
            exit(1);
            return;
          }
          lifecycle.shutdown({ reason: signal });
        });
      }

      proc.on("uncaughtException", (error) => {
        logger.fatal({ err: error }, "Uncaught exception");
        lifecycle.shutdown({ reason: "uncaughtException", exitCode: 1 });
      });
      proc.on("unhandledRejection", (reason) => {
        logger.fatal({ err: reason }, "Unhandled promise rejection");
        lifecycle.shutdown({ reason: "unhandledRejection", exitCode: 1 });
      });
    },
  };

  return lifecycle;
}
