import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TimerImpression } from "../analytics/analytics.model.js";
import {
  NOW,
  OTHER_SHOP,
  SHOP,
  buildStorefrontTestApp,
  evergreenPayload,
  insertEvergreenTimer,
  insertTimer,
  signedProxyQuery,
  startDatabase,
  timerPayload,
} from "../test/helpers.js";
import { Timer } from "../timers/timer.model.js";

import { IMPRESSION_GRACE_MS, LOOKAHEAD_MS, MAX_TIMERS_PER_RESPONSE } from "./storefront-timers.js";

const PRODUCT = "1001";
const COLLECTION = "2001";
const HOUR = 3_600_000;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

let stopDatabase;
let app;
let storefrontTimers;
let impressionRecorder;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await Promise.all([Timer.deleteMany({}), TimerImpression.deleteMany({})]);
  ({ app, storefrontTimers, impressionRecorder } = buildStorefrontTestApp());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getTimers(params = { product: PRODUCT }, options) {
  return request(app).get(`/api/storefront/timers?${signedProxyQuery(params, options)}`);
}

const productTarget = (id = PRODUCT) => ({
  type: "products",
  resources: [{ id: `gid://shopify/Product/${id}`, title: "Snowboard" }],
});
const collectionTarget = (id = COLLECTION) => ({
  type: "collections",
  resources: [{ id: `gid://shopify/Collection/${id}`, title: "Winter sale" }],
});

describe("app proxy authentication", () => {
  it("rejects requests that weren't signed by Shopify", async () => {
    const unsigned = await request(app).get(`/api/storefront/timers?shop=${SHOP}&product=1`);
    const forged = await getTimers({ product: PRODUCT }, { secret: "wrong-secret" });

    for (const response of [unsigned, forged]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_SIGNATURE");
    }
  });

  it("rejects replayed requests with an old timestamp", async () => {
    const response = await getTimers(
      { product: PRODUCT },
      { timestamp: Math.floor(Date.now() / 1000) - 600 },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a tampered query even when the signature is well-formed", async () => {
    const query = signedProxyQuery({ product: PRODUCT }).replace(
      `shop=${SHOP}`,
      `shop=${OTHER_SHOP}`,
    );
    const response = await request(app).get(`/api/storefront/timers?${query}`);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/storefront/timers", () => {
  it("returns running timers with the public fields only", async () => {
    const timer = await insertTimer({
      name: "Internal name",
      description: "Winter sale ends soon",
      startsAt: at(-HOUR),
      endsAt: at(2 * HOUR),
      color: "#b98900",
      size: "large",
      urgency: "shake",
    });

    const response = await getTimers();

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      timers: [
        {
          id: timer.id,
          type: "countdown",
          startsAt: at(-HOUR).toISOString(),
          endsAt: at(2 * HOUR).toISOString(),
          message: "Winter sale ends soon",
          color: "#b98900",
          size: "large",
          urgency: "shake",
          priority: 1,
        },
      ],
      serverTime: NOW.toISOString(),
      refreshInterval: 60,
    });
  });

  it("returns an empty list when no timer applies", async () => {
    await insertTimer({ target: productTarget("9999") });
    await insertTimer({ target: collectionTarget("8888") });

    const response = await getTimers({ product: PRODUCT, collections: "2001,2002" });

    expect(response.status).toBe(200);
    expect(response.body.timers).toEqual([]);
  });

  it("matches timers by product, collection or all products, most specific first", async () => {
    const all = await insertTimer({ endsAt: at(1 * HOUR) });
    const byCollection = await insertTimer({ target: collectionTarget(), endsAt: at(3 * HOUR) });
    const byProduct = await insertTimer({ target: productTarget(), endsAt: at(5 * HOUR) });

    const response = await getTimers({ product: PRODUCT, collections: `7,${COLLECTION}` });

    expect(response.body.timers.map((timer) => timer.id)).toEqual([
      byProduct.id,
      byCollection.id,
      all.id,
    ]);
  });

  it("puts the timer that ends soonest first among equally specific timers", async () => {
    const later = await insertTimer({ endsAt: at(5 * HOUR) });
    const sooner = await insertTimer({ endsAt: at(1 * HOUR) });

    const response = await getTimers();

    expect(response.body.timers.map((timer) => timer.id)).toEqual([sooner.id, later.id]);
  });

  it("leaves out expired timers and timers that start beyond the look-ahead window", async () => {
    await insertTimer({ startsAt: at(-5 * HOUR), endsAt: at(-HOUR) });
    await insertTimer({ startsAt: at(LOOKAHEAD_MS + 60_000), endsAt: at(48 * HOUR) });
    const upcoming = await insertTimer({ startsAt: at(5 * 60_000), endsAt: at(HOUR) });

    const response = await getTimers();

    expect(response.body.timers.map((timer) => timer.id)).toEqual([upcoming.id]);
  });

  it("returns evergreen timers with their duration instead of a schedule", async () => {
    const timer = await insertEvergreenTimer({
      name: "Internal name",
      description: "Your welcome offer ends in",
      durationMinutes: 45,
      color: "#2c6ecb",
      size: "small",
      urgency: "color_pulse",
      target: productTarget(),
    });

    const response = await getTimers();

    expect(response.body.timers).toEqual([
      {
        id: timer.id,
        type: "evergreen",
        durationMinutes: 45,
        message: "Your welcome offer ends in",
        color: "#2c6ecb",
        size: "small",
        urgency: "color_pulse",
        priority: 3,
      },
    ]);
  });

  it("orders evergreen timers by targeting, then by when they'd end for a new shopper", async () => {
    const countdown = await insertTimer({ endsAt: at(2 * HOUR) });
    const shortEvergreen = await insertEvergreenTimer({ durationMinutes: 30 });
    const longEvergreen = await insertEvergreenTimer({ durationMinutes: 5 * 60 });
    const productEvergreen = await insertEvergreenTimer({
      durationMinutes: 24 * 60,
      target: productTarget(),
    });

    const response = await getTimers();

    expect(response.body.timers.map(({ id, priority }) => [id, priority])).toEqual([
      [productEvergreen.id, 3],
      [shortEvergreen.id, 1],
      [countdown.id, 1],
      [longEvergreen.id, 1],
    ]);
  });

  it("keeps sending evergreen timers however long ago they were created", async () => {
    await insertEvergreenTimer({ createdAt: at(-365 * 24 * HOUR) });
    await insertTimer({ startsAt: at(-5 * HOUR), endsAt: at(-HOUR) });

    const response = await getTimers();

    expect(response.body.timers.map((timer) => timer.type)).toEqual(["evergreen"]);
  });

  it("only returns the signed shop's timers", async () => {
    await insertTimer({ shop: OTHER_SHOP });
    const response = await getTimers();
    expect(response.body.timers).toEqual([]);
  });

  it(`returns at most ${MAX_TIMERS_PER_RESPONSE} timers`, async () => {
    await Promise.all(
      Array.from({ length: MAX_TIMERS_PER_RESPONSE + 3 }, (_, index) =>
        insertTimer({ endsAt: at((index + 1) * HOUR) }),
      ),
    );
    const response = await getTimers();
    expect(response.body.timers).toHaveLength(MAX_TIMERS_PER_RESPONSE);
  });

  it.each([
    [{}, "product"],
    [{ product: "abc" }, "product"],
    [{ product: PRODUCT, collections: "1,two" }, "collections.1"],
  ])("validates the query %o", async (params, field) => {
    const response = await getTimers(params);
    expect(response.status).toBe(422);
    expect(response.body.error.fields).toHaveProperty(field);
  });

  it("returns JSON 404s for unknown storefront routes", async () => {
    const response = await request(app).get(`/api/storefront/nope?${signedProxyQuery()}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});

describe("caching", () => {
  it("shows evergreen timers created in the admin right away", async () => {
    expect((await getTimers()).body.timers).toEqual([]);

    await request(app).post("/api/timers").set("x-test-shop", SHOP).send(evergreenPayload());

    expect((await getTimers()).body.timers).toMatchObject([{ type: "evergreen" }]);
  });

  it("answers repeat requests from memory", async () => {
    await insertTimer();
    const find = vi.spyOn(Timer, "find");

    await getTimers();
    await getTimers({ product: "555" });
    await getTimers();

    expect(find).toHaveBeenCalledTimes(1);
  });

  it("shares one database query between concurrent requests", async () => {
    await insertTimer();
    const find = vi.spyOn(Timer, "find");

    const responses = await Promise.all([getTimers(), getTimers(), getTimers()]);

    expect(responses.every((response) => response.body.timers.length === 1)).toBe(true);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("shows changes made in the admin right away", async () => {
    expect((await getTimers()).body.timers).toEqual([]);

    const created = await request(app)
      .post("/api/timers")
      .send(timerPayload({ startDate: "", startTime: "", endDate: "2026-11-28" }));
    expect(created.status).toBe(201);
    expect((await getTimers()).body.timers).toHaveLength(1);

    await request(app).delete(`/api/timers/${created.body.timer.id}`);
    expect((await getTimers()).body.timers).toEqual([]);
  });

  it("reloads after the cache expires", async () => {
    let now = NOW;
    ({ app } = buildStorefrontTestApp({ now: () => now }));
    expect((await getTimers()).body.timers).toEqual([]);

    // Written by another instance, so this one isn't told about it.
    await insertTimer();
    expect((await getTimers()).body.timers).toEqual([]);

    now = new Date(NOW.getTime() + 31_000);
    expect((await getTimers()).body.timers).toHaveLength(1);
  });

  it("drops a running timer as soon as it ends, without a reload", async () => {
    let now = NOW;
    ({ app } = buildStorefrontTestApp({ now: () => now }));
    await insertTimer({ endsAt: at(10_000) });

    expect((await getTimers()).body.timers).toHaveLength(1);
    now = at(10_000);
    expect((await getTimers()).body.timers).toEqual([]);
  });

  it("doesn't keep a failed load", async () => {
    vi.spyOn(Timer, "find").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    expect((await getTimers()).status).toBe(500);

    await insertTimer();
    expect((await getTimers()).body.timers).toHaveLength(1);
  });

  it("ignores a load that finishes after the cache was invalidated", async () => {
    await insertTimer();
    const pending = storefrontTimers.forProduct(SHOP, { productId: PRODUCT, collectionIds: [] });
    storefrontTimers.invalidate(SHOP);
    await Timer.deleteMany({});
    await pending;

    expect((await getTimers()).body.timers).toEqual([]);
  });
});

describe("rate limiting", () => {
  it("limits each shopper separately", async () => {
    ({ app } = buildStorefrontTestApp({ rateLimit: { storefrontMax: 2 } }));
    const fromShopper = (ip) =>
      request(app)
        .get(`/api/storefront/timers?${signedProxyQuery({ product: PRODUCT })}`)
        .set("X-Forwarded-For", ip);

    expect((await fromShopper("203.0.113.1")).status).toBe(200);
    expect((await fromShopper("203.0.113.1")).status).toBe(200);
    const limited = await fromShopper("203.0.113.1");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect((await fromShopper("203.0.113.2")).status).toBe(200);
  });
});

function postImpressions(body, { type = "application/json", ...options } = {}) {
  return request(app)
    .post(`/api/storefront/impressions?${signedProxyQuery({}, options)}`)
    .set("Content-Type", type)
    .send(typeof body === "string" ? body : JSON.stringify(body));
}

/** Writes buffered impressions, then returns each timer's stored count. */
async function storedImpressions() {
  await impressionRecorder.flush();
  const rows = await TimerImpression.find({}).lean();
  return Object.fromEntries(rows.map((row) => [row.timerId.toString(), row.count]));
}

describe("POST /api/storefront/impressions", () => {
  it("counts a view of each timer, for today (UTC)", async () => {
    const countdown = await insertTimer({ startsAt: at(-HOUR), endsAt: at(HOUR) });
    const evergreen = await insertEvergreenTimer();

    const response = await postImpressions({ timers: [countdown.id, evergreen.id] });
    await postImpressions({ timers: [countdown.id] });

    expect(response.status).toBe(204);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(await storedImpressions()).toEqual({ [countdown.id]: 2, [evergreen.id]: 1 });
    const row = await TimerImpression.findOne({ timerId: countdown._id }).lean();
    expect(row).toMatchObject({ shop: SHOP, day: new Date("2026-11-27T00:00:00.000Z") });
    expect(Object.keys(row).sort()).toEqual(["_id", "count", "day", "shop", "timerId"]);
  });

  it("accepts the text/plain body navigator.sendBeacon sends", async () => {
    const timer = await insertEvergreenTimer();

    const response = await postImpressions(JSON.stringify({ timers: [timer.id] }), {
      type: "text/plain;charset=UTF-8",
    });

    expect(response.status).toBe(204);
    expect(await storedImpressions()).toEqual({ [timer.id]: 1 });
  });

  it("counts each timer once per report", async () => {
    const timer = await insertEvergreenTimer();
    await postImpressions({ timers: [timer.id, timer.id, timer.id.toUpperCase()] });
    expect(await storedImpressions()).toEqual({ [timer.id]: 1 });
  });

  it("ignores timers shoppers can't be seeing", async () => {
    const scheduled = await insertTimer({ startsAt: at(HOUR), endsAt: at(2 * HOUR) });
    const expired = await insertTimer({ startsAt: at(-2 * HOUR), endsAt: at(-HOUR) });
    const otherShop = await insertEvergreenTimer({ shop: OTHER_SHOP });
    const deleted = "64b7f0c2a1b2c3d4e5f60718";

    const response = await postImpressions({
      timers: [scheduled.id, expired.id, otherShop.id, deleted],
    });

    expect(response.status).toBe(204);
    expect(await storedImpressions()).toEqual({});
  });

  it("still counts a countdown that ended a moment ago", async () => {
    let current = NOW;
    ({ app, impressionRecorder, storefrontTimers } = buildStorefrontTestApp({
      now: () => current,
    }));
    const timer = await insertTimer({ startsAt: at(-HOUR), endsAt: at(1_000) });

    current = at(1_000 + IMPRESSION_GRACE_MS - 1);
    await postImpressions({ timers: [timer.id] });
    expect(await storedImpressions()).toEqual({ [timer.id]: 1 });

    current = at(1_000 + IMPRESSION_GRACE_MS + 1);
    storefrontTimers.invalidate(SHOP);
    await postImpressions({ timers: [timer.id] });
    expect(await storedImpressions()).toEqual({ [timer.id]: 1 });
  });

  it("rejects malformed reports", async () => {
    const cases = [
      [{}, 422],
      [{ timers: [] }, 422],
      [{ timers: ["not-an-id"] }, 422],
      [{ timers: "64b7f0c2a1b2c3d4e5f60718" }, 422],
      [
        {
          timers: Array.from(
            { length: MAX_TIMERS_PER_RESPONSE + 1 },
            () => "64b7f0c2a1b2c3d4e5f60718",
          ),
        },
        422,
      ],
      ["{not json", 400],
    ];
    for (const [body, status] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const response = await postImpressions(body);
      expect({ body, status: response.status }).toEqual({ body, status });
    }
    expect(await storedImpressions()).toEqual({});
  });

  it("rejects oversized reports", async () => {
    const response = await postImpressions({
      timers: ["64b7f0c2a1b2c3d4e5f60718"],
      pad: "x".repeat(4_000),
    });
    expect(response.status).toBe(413);
  });

  it("only takes reports signed by Shopify", async () => {
    const timer = await insertEvergreenTimer();
    const forged = await postImpressions({ timers: [timer.id] }, { secret: "wrong-secret" });
    const unsigned = await request(app)
      .post(`/api/storefront/impressions?shop=${SHOP}`)
      .send({ timers: [timer.id] });

    expect(forged.status).toBe(401);
    expect(unsigned.status).toBe(401);
    expect(await storedImpressions()).toEqual({});
  });

  it("answers from the cache, without querying MongoDB", async () => {
    const timer = await insertEvergreenTimer();
    await getTimers();
    const find = vi.spyOn(Timer, "find");

    await postImpressions({ timers: [timer.id] });

    expect(find).not.toHaveBeenCalled();
    expect(await storedImpressions()).toEqual({ [timer.id]: 1 });
  });
});
