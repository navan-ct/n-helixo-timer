import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOW,
  OTHER_SHOP,
  SHOP,
  buildStorefrontTestApp,
  insertTimer,
  signedProxyQuery,
  startDatabase,
  timerPayload,
} from "../test/helpers.js";
import { Timer } from "../timers/timer.model.js";

import { LOOKAHEAD_MS, MAX_TIMERS_PER_RESPONSE } from "./storefront-timers.js";

const PRODUCT = "1001";
const COLLECTION = "2001";
const HOUR = 3_600_000;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

let stopDatabase;
let app;
let storefrontTimers;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await Timer.deleteMany({});
  ({ app, storefrontTimers } = buildStorefrontTestApp());
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
