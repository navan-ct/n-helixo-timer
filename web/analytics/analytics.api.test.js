import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  NOW,
  OTHER_SHOP,
  SHOP,
  buildTestApp,
  insertEvergreenTimer,
  insertImpressions,
  insertTimer,
  startDatabase,
} from "../test/helpers.js";
import { Timer } from "../timers/timer.model.js";

import { TimerImpression } from "./analytics.model.js";
import { SUMMARY_DAYS } from "./analytics.service.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Midnight UTC, `days` days before NOW's day. */
const daysAgo = (days) => new Date(Date.UTC(2026, 10, 27) - days * DAY);
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

let stopDatabase;
let app;
let analyticsService;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await Promise.all([Timer.deleteMany({}), TimerImpression.deleteMany({})]);
  ({ app, analyticsService } = buildTestApp());
});

const getAnalytics = (shop = SHOP) => request(app).get("/api/analytics").set("x-test-shop", shop);

describe("GET /api/analytics", () => {
  it("reports nothing for a new shop", async () => {
    const response = await getAnalytics();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      impressions: { days: SUMMARY_DAYS, current: 0, previous: 0 },
      timers: { running: 0, scheduled: 0, evergreen: 0 },
    });
  });

  it("sums impressions for the last 30 days and the 30 days before", async () => {
    const timer = await insertTimer();
    const other = await insertEvergreenTimer();
    await Promise.all([
      insertImpressions({ timerId: timer._id, day: daysAgo(0), count: 5 }),
      insertImpressions({ timerId: other._id, day: daysAgo(0), count: 2 }),
      // The oldest day of the current period.
      insertImpressions({ timerId: timer._id, day: daysAgo(SUMMARY_DAYS - 1), count: 3 }),
      // The newest and oldest days of the previous period.
      insertImpressions({ timerId: timer._id, day: daysAgo(SUMMARY_DAYS), count: 7 }),
      insertImpressions({ timerId: timer._id, day: daysAgo(2 * SUMMARY_DAYS - 1), count: 1 }),
      // Too old to count.
      insertImpressions({ timerId: timer._id, day: daysAgo(2 * SUMMARY_DAYS), count: 100 }),
      // Another shop's.
      insertImpressions({ shop: OTHER_SHOP, timerId: timer._id, day: daysAgo(0), count: 50 }),
    ]);

    const { body } = await getAnalytics();

    expect(body.impressions).toEqual({ days: SUMMARY_DAYS, current: 10, previous: 8 });
  });

  it("keeps counting impressions of deleted timers", async () => {
    const timer = await insertTimer();
    await insertImpressions({ timerId: timer._id, day: daysAgo(1), count: 4 });
    await request(app).delete(`/api/timers/${timer.id}`).set("x-test-shop", SHOP).expect(204);

    const { body } = await getAnalytics();

    expect(body.impressions.current).toBe(4);
  });

  it("counts running and scheduled countdowns and evergreen timers", async () => {
    await Promise.all([
      insertTimer({ startsAt: at(-HOUR), endsAt: at(HOUR) }),
      insertTimer({ startsAt: at(-HOUR), endsAt: at(2 * HOUR) }),
      insertTimer({ startsAt: at(HOUR), endsAt: at(2 * HOUR) }),
      insertTimer({ startsAt: at(-2 * HOUR), endsAt: at(-HOUR) }),
      insertEvergreenTimer(),
      insertEvergreenTimer({ shop: OTHER_SHOP }),
    ]);

    const { body } = await getAnalytics();

    expect(body.timers).toEqual({ running: 2, scheduled: 1, evergreen: 1 });
  });

  it("only reports the current shop's data", async () => {
    const timer = await insertTimer({ shop: OTHER_SHOP });
    await insertImpressions({ shop: OTHER_SHOP, timerId: timer._id, day: daysAgo(0), count: 9 });

    const { body } = await getAnalytics();

    expect(body.impressions.current).toBe(0);
    expect(body.timers.running).toBe(0);
  });
});

describe("impressions in timer lists", () => {
  it("shows each timer's all-time impressions", async () => {
    const seen = await insertTimer({ name: "Seen" });
    await insertTimer({ name: "Unseen" });
    await Promise.all([
      insertImpressions({ timerId: seen._id, day: daysAgo(0), count: 3 }),
      insertImpressions({ timerId: seen._id, day: daysAgo(400), count: 40 }),
      // The same ID in another shop's data never adds up.
      insertImpressions({ shop: OTHER_SHOP, timerId: seen._id, day: daysAgo(0), count: 1000 }),
    ]);

    const response = await request(app).get("/api/timers").set("x-test-shop", SHOP);

    const impressions = Object.fromEntries(
      response.body.timers.map((timer) => [timer.name, timer.impressions]),
    );
    expect(impressions).toEqual({ Seen: 43, Unseen: 0 });
  });

  it("includes evergreen timers", async () => {
    const timer = await insertEvergreenTimer();
    await insertImpressions({ timerId: timer._id, day: daysAgo(2), count: 6 });

    const response = await request(app).get("/api/timers?type=evergreen").set("x-test-shop", SHOP);

    expect(response.body.timers[0].impressions).toBe(6);
  });
});

describe("shop data removal", () => {
  it("deletes only the shop's analytics", async () => {
    const timer = await insertTimer();
    await insertImpressions({ timerId: timer._id, day: daysAgo(0), count: 1 });
    await insertImpressions({ shop: OTHER_SHOP, timerId: timer._id, day: daysAgo(0), count: 1 });

    await expect(analyticsService.removeAllForShop(SHOP)).resolves.toBe(1);

    expect(await TimerImpression.countDocuments({ shop: SHOP })).toBe(0);
    expect(await TimerImpression.countDocuments({ shop: OTHER_SHOP })).toBe(1);
  });
});

describe("database setup", () => {
  it("creates the analytics indexes at startup", async () => {
    const impressionIndexes = await TimerImpression.collection.indexes();

    expect(impressionIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { shop: 1, timerId: 1, day: 1 }, unique: true }),
        expect.objectContaining({ key: { shop: 1, day: 1 } }),
      ]),
    );
  });
});
