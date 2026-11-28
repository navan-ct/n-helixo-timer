import { startOfUtcDay } from "./analytics.model.js";

/** How often buffered impressions are written to MongoDB. */
export const FLUSH_INTERVAL_MS = 10_000;
/** Buffered counters that trigger an early write, so memory stays bounded under heavy traffic. */
export const MAX_PENDING = 5_000;

/**
 * Buffers timer impressions in memory and writes them in batches, so product
 * page traffic never waits on (or floods) the database. Every product view
 * would otherwise be a write; buffered, each instance writes one increment per
 * timer per day every `flushIntervalMs`, and `$inc` lets instances write
 * concurrently.
 *
 * Writes are at most once: a batch that fails is logged and dropped rather
 * than retried, because a partly applied batch can't be told apart from one
 * that never ran, and retrying it would count views twice. Stopping writes
 * whatever is still buffered (register `stop` as a shutdown hook).
 *
 * @param {{
 *   TimerImpression: import("mongoose").Model<any>,
 *   logger: import("pino").Logger,
 *   now?: () => Date,
 *   flushIntervalMs?: number,
 *   maxPending?: number,
 * }} deps
 */
export function createImpressionRecorder({
  TimerImpression,
  logger,
  now = () => new Date(),
  flushIntervalMs = FLUSH_INTERVAL_MS,
  maxPending = MAX_PENDING,
}) {
  const log = logger.child({ component: "impression-recorder" });
  /** "shop|timerId|day" -> { shop, timerId, day, count } */
  let pending = new Map();
  let interval = null;
  /** The last flush in line. */
  let queue = Promise.resolve();

  async function write(batch) {
    await TimerImpression.bulkWrite(
      [...batch.values()].map(({ shop, timerId, day, count }) => ({
        updateOne: {
          filter: { shop, timerId, day },
          update: { $inc: { count } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  /**
   * Writes everything buffered so far. Resolves when it's written (or dropped).
   * Flushes queue up behind each other, so one batch is written at a time; each
   * takes whatever was recorded by the time its turn comes.
   */
  function flush() {
    const run = queue.then(() => {
      if (pending.size === 0) return undefined;
      const batch = pending;
      pending = new Map();
      return write(batch).catch((error) => {
        log.warn(
          { err: error, counters: batch.size },
          "Couldn't save timer impressions; this batch is dropped",
        );
      });
    });
    queue = run;
    return run;
  }

  return {
    /**
     * Counts one view of each timer, today (UTC).
     * @param {string} shop
     * @param {string[]} timerIds Distinct IDs of the shop's timers
     */
    recordImpressions(shop, timerIds) {
      const day = startOfUtcDay(now());
      for (const timerId of timerIds) {
        const key = `${shop}|${timerId}|${day.getTime()}`;
        const entry = pending.get(key);
        if (entry) entry.count += 1;
        else pending.set(key, { shop, timerId, day, count: 1 });
      }
      if (pending.size >= maxPending) void flush();
    },

    flush,

    /** Starts writing on an interval. The interval doesn't keep the process alive. */
    start() {
      if (interval) return;
      interval = setInterval(() => void flush(), flushIntervalMs);
      interval.unref?.();
    },

    /** Stops the interval and writes what's left. */
    async stop() {
      clearInterval(interval);
      interval = null;
      await flush();
    },
  };
}
