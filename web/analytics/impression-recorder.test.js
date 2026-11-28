import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { silentLogger } from "../lib/logger.js";
import { NOW, OTHER_SHOP, SHOP, startDatabase } from "../test/helpers.js";

import { TimerImpression } from "./analytics.model.js";
import { createImpressionRecorder } from "./impression-recorder.js";

const TIMER_A = "64b7f0c2a1b2c3d4e5f60701";
const TIMER_B = "64b7f0c2a1b2c3d4e5f60702";
const TODAY = new Date("2026-11-27T00:00:00.000Z");

let stopDatabase;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await TimerImpression.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function recorder(options = {}) {
  return createImpressionRecorder({
    TimerImpression,
    logger: silentLogger,
    now: () => NOW,
    ...options,
  });
}

const counts = async () =>
  (await TimerImpression.find({}).sort({ shop: 1, timerId: 1, day: 1 }).lean()).map(
    ({ shop, timerId, day, count }) => ({ shop, timerId: timerId.toString(), day, count }),
  );

describe("impression recorder", () => {
  it("writes nothing until it flushes", async () => {
    const impressions = recorder();
    impressions.recordImpressions(SHOP, [TIMER_A]);

    expect(await TimerImpression.countDocuments()).toBe(0);
  });

  it("adds up views per timer, shop and day, and adds to what's stored", async () => {
    const impressions = recorder();
    impressions.recordImpressions(SHOP, [TIMER_A, TIMER_B]);
    impressions.recordImpressions(SHOP, [TIMER_A]);
    impressions.recordImpressions(OTHER_SHOP, [TIMER_A]);
    await impressions.flush();
    impressions.recordImpressions(SHOP, [TIMER_A]);
    await impressions.flush();

    expect(await counts()).toEqual([
      { shop: SHOP, timerId: TIMER_A, day: TODAY, count: 3 },
      { shop: SHOP, timerId: TIMER_B, day: TODAY, count: 1 },
      { shop: OTHER_SHOP, timerId: TIMER_A, day: TODAY, count: 1 },
    ]);
  });

  it("starts a new count each UTC day", async () => {
    let now = new Date("2026-11-27T23:59:59.000Z");
    const impressions = recorder({ now: () => now });
    impressions.recordImpressions(SHOP, [TIMER_A]);
    now = new Date("2026-11-28T00:00:00.000Z");
    impressions.recordImpressions(SHOP, [TIMER_A]);
    await impressions.flush();

    expect((await counts()).map(({ day, count }) => [day.toISOString(), count])).toEqual([
      ["2026-11-27T00:00:00.000Z", 1],
      ["2026-11-28T00:00:00.000Z", 1],
    ]);
  });

  it("writes early when the buffer fills up", async () => {
    const impressions = recorder({ maxPending: 2 });
    const bulkWrite = vi.spyOn(TimerImpression, "bulkWrite");

    impressions.recordImpressions(SHOP, [TIMER_A]);
    expect(bulkWrite).not.toHaveBeenCalled();
    impressions.recordImpressions(SHOP, [TIMER_B]);
    await impressions.flush();

    expect(bulkWrite).toHaveBeenCalledOnce();
    expect(await TimerImpression.countDocuments()).toBe(2);
  });

  it("writes one batch at a time, and doesn't lose views recorded meanwhile", async () => {
    const impressions = recorder();
    impressions.recordImpressions(SHOP, [TIMER_A]);
    const first = impressions.flush();
    impressions.recordImpressions(SHOP, [TIMER_A]);
    const second = impressions.flush();
    await Promise.all([first, second]);

    expect(await counts()).toEqual([{ shop: SHOP, timerId: TIMER_A, day: TODAY, count: 2 }]);
  });

  it("logs and drops a batch it couldn't write, and carries on", async () => {
    const warn = vi.fn();
    const logger = { child: () => ({ warn }) };
    const impressions = recorder({ logger });
    vi.spyOn(TimerImpression, "bulkWrite").mockRejectedValueOnce(new Error("db down"));

    impressions.recordImpressions(SHOP, [TIMER_A]);
    await impressions.flush();
    impressions.recordImpressions(SHOP, [TIMER_B]);
    await impressions.flush();

    expect(warn).toHaveBeenCalledOnce();
    expect(await counts()).toEqual([{ shop: SHOP, timerId: TIMER_B, day: TODAY, count: 1 }]);
  });

  it("writes on an interval once started, and what's left when stopped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const impressions = recorder({ flushIntervalMs: 1_000 });
      const bulkWrite = vi.spyOn(TimerImpression, "bulkWrite");
      impressions.start();

      impressions.recordImpressions(SHOP, [TIMER_A]);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(bulkWrite).toHaveBeenCalledOnce());

      impressions.recordImpressions(SHOP, [TIMER_B]);
      await impressions.stop();
      expect(bulkWrite).toHaveBeenCalledTimes(2);
      expect(await TimerImpression.countDocuments()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
