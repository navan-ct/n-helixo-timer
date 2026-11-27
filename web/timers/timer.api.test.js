import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OTHER_SHOP,
  SHOP,
  buildTestApp,
  createFakeGraphqlClient,
  insertTimer,
  startDatabase,
  timerPayload,
} from "../test/helpers.js";

import { TIMER_LIMITS } from "./timer.constants.js";
import { Timer } from "./timer.model.js";

let stopDatabase;
let app;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await Timer.deleteMany({});
  ({ app } = buildTestApp());
});

const createTimer = (payload = timerPayload(), shop = SHOP) =>
  request(app).post("/api/timers").set("x-test-shop", shop).send(payload);

describe("POST /api/timers", () => {
  it("creates a timer and returns it", async () => {
    const response = await createTimer();

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/timers/${response.body.timer.id}`);
    expect(response.body.timer).toMatchObject({
      name: "Black Friday Sale",
      description: "50% off all products",
      startsAt: "2026-11-29T05:00:00.000Z",
      endsAt: "2026-12-01T04:59:00.000Z",
      timezone: "America/New_York",
      schedule: {
        startDate: "2026-11-29",
        startTime: "00:00",
        endDate: "2026-11-30",
        endTime: "23:59",
      },
      color: "#008060",
      size: "medium",
      urgency: "color_pulse",
      target: { type: "all", resources: [] },
      status: "scheduled",
    });

    const stored = await Timer.findById(response.body.timer.id).lean();
    expect(stored.shop).toBe(SHOP);
  });

  it("sanitizes text before storing it", async () => {
    const response = await createTimer(
      timerPayload({
        name: "  <script>x</script>Flash   sale ",
        description: "<p>Ends\u200B soon</p>",
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.timer.name).toBe("xFlash sale");
    expect(response.body.timer.description).toBe("Ends soon");
  });

  it("starts immediately when the start is left blank", async () => {
    const response = await createTimer(timerPayload({ startDate: "", startTime: "" }));
    expect(response.status).toBe(201);
    expect(response.body.timer.startsAt).toBe("2026-11-27T12:00:00.000Z");
    expect(response.body.timer.status).toBe("active");
  });

  it("stores product details from Shopify, not from the client", async () => {
    const response = await createTimer(
      timerPayload({
        target: {
          type: "products",
          resourceIds: ["gid://shopify/Product/1001", "gid://shopify/Product/1002"],
        },
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.timer.target).toEqual({
      type: "products",
      resources: [
        {
          id: "gid://shopify/Product/1001",
          title: "Snowboard",
          handle: "snowboard",
          imageUrl: "https://cdn.test/snowboard.png",
          imageAlt: "Board",
        },
        {
          id: "gid://shopify/Product/1002",
          title: "Ski wax",
          handle: "ski-wax",
          imageUrl: null,
          imageAlt: "",
        },
      ],
    });
  });

  it("targets collections", async () => {
    const response = await createTimer(
      timerPayload({
        target: { type: "collections", resourceIds: ["gid://shopify/Collection/2001"] },
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.timer.target.resources[0]).toMatchObject({ title: "Winter sale" });
  });

  it("rejects products that don't exist in the shop", async () => {
    const response = await createTimer(
      timerPayload({
        target: { type: "products", resourceIds: ["gid://shopify/Product/9999"] },
      }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.fields["target.resourceIds"]).toMatch(/no longer exists/);
    expect(await Timer.countDocuments()).toBe(0);
  });

  it("returns field errors for invalid input", async () => {
    const response = await createTimer({ ...timerPayload(), name: "", endDate: "2026-11-28" });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: { name: "Enter a timer name." },
    });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it("rejects an end before the start", async () => {
    const response = await createTimer(timerPayload({ endDate: "2026-11-28" }));
    expect(response.status).toBe(422);
    expect(response.body.error.fields).toEqual({
      endDate: "End must be after the start date and time.",
    });
  });

  it("rejects an end in the past", async () => {
    const response = await createTimer(
      timerPayload({ startDate: "", startTime: "", endDate: "2026-11-26" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.fields.endDate).toBe("End must be in the future.");
  });

  it("rejects malformed JSON", async () => {
    const response = await request(app)
      .post("/api/timers")
      .set("Content-Type", "application/json")
      .send('{"name": ');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("rejects bodies that aren't JSON", async () => {
    const response = await request(app)
      .post("/api/timers")
      .set("Content-Type", "text/plain")
      .send("name=Sale");
    expect(response.status).toBe(415);
  });

  it("rejects oversized bodies", async () => {
    const response = await createTimer(timerPayload({ description: "x".repeat(20_000) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("caps the number of timers per shop", async () => {
    await Timer.insertMany(
      Array.from({ length: TIMER_LIMITS.MAX_TIMERS_PER_SHOP }, (_, i) => ({
        shop: SHOP,
        name: `Timer ${i}`,
        startsAt: new Date("2026-11-20T00:00:00Z"),
        endsAt: new Date("2026-12-20T00:00:00Z"),
        timezone: "UTC",
        color: "#000000",
        size: "small",
        urgency: "none",
        target: { type: "all", resources: [] },
      })),
    );
    const response = await createTimer();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMER_LIMIT_REACHED");
  });

  it("returns 502 when Shopify can't be reached", async () => {
    ({ app } = buildTestApp({ graphql: createFakeGraphqlClient({ fail: true }) }));
    const response = await createTimer();
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("SHOPIFY_REQUEST_FAILED");
  });
});

describe("GET /api/timers", () => {
  const list = (query = {}, shop = SHOP) =>
    request(app).get("/api/timers").query(query).set("x-test-shop", shop);

  beforeEach(async () => {
    await insertTimer({
      name: "active sale",
      description: "Live now",
      startsAt: new Date("2026-11-20T00:00:00Z"),
      endsAt: new Date("2026-12-01T00:00:00Z"),
      createdAt: new Date("2026-11-01T00:00:00Z"),
    });
    await insertTimer({
      name: "Black Friday (50% off)",
      startsAt: new Date("2026-11-28T05:00:00Z"),
      endsAt: new Date("2026-11-29T05:00:00Z"),
      createdAt: new Date("2026-11-02T00:00:00Z"),
    });
    await insertTimer({
      name: "Summer sale",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      endsAt: new Date("2026-06-30T00:00:00Z"),
      createdAt: new Date("2026-11-03T00:00:00Z"),
    });
    await insertTimer({ shop: OTHER_SHOP, name: "Other shop's sale" });
  });

  it("lists only the current shop's timers, newest first", async () => {
    const response = await list();

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.timers.map((t) => t.name)).toEqual([
      "Summer sale",
      "Black Friday (50% off)",
      "active sale",
    ]);
    expect(response.body.pageInfo).toEqual({
      page: 1,
      pageSize: TIMER_LIMITS.PAGE_SIZE,
      total: 3,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(response.body.timezone).toBe("America/New_York");
  });

  it("computes each timer's status", async () => {
    const response = await list({ sort: "start_asc" });
    expect(response.body.timers.map((t) => [t.name, t.status])).toEqual([
      ["Summer sale", "expired"],
      ["active sale", "active"],
      ["Black Friday (50% off)", "scheduled"],
    ]);
  });

  it.each([
    ["active", ["active sale"]],
    ["scheduled", ["Black Friday (50% off)"]],
    ["expired", ["Summer sale"]],
  ])("filters by %s status", async (status, names) => {
    const response = await list({ status });
    expect(response.body.timers.map((t) => t.name)).toEqual(names);
  });

  it("searches names and descriptions case-insensitively, treating input literally", async () => {
    expect((await list({ query: "SALE" })).body.timers).toHaveLength(2);
    expect((await list({ query: "live" })).body.timers.map((t) => t.name)).toEqual(["active sale"]);
    expect((await list({ query: "(50% off)" })).body.timers.map((t) => t.name)).toEqual([
      "Black Friday (50% off)",
    ]);
    expect((await list({ query: ".*" })).body.timers).toHaveLength(0);
  });

  it("sorts names case-insensitively", async () => {
    const response = await list({ sort: "name_asc" });
    expect(response.body.timers.map((t) => t.name)).toEqual([
      "active sale",
      "Black Friday (50% off)",
      "Summer sale",
    ]);
  });

  it("paginates", async () => {
    await Timer.insertMany(
      Array.from({ length: TIMER_LIMITS.PAGE_SIZE }, (_, i) => ({
        shop: SHOP,
        name: `Bulk ${i}`,
        startsAt: new Date("2026-11-20T00:00:00Z"),
        endsAt: new Date("2026-12-20T00:00:00Z"),
        timezone: "UTC",
        color: "#000000",
        size: "small",
        urgency: "none",
        target: { type: "all", resources: [] },
      })),
    );

    const page2 = await list({ page: 2 });
    expect(page2.body.timers).toHaveLength(3);
    expect(page2.body.pageInfo).toMatchObject({
      page: 2,
      total: TIMER_LIMITS.PAGE_SIZE + 3,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it("rejects invalid query parameters", async () => {
    expect((await list({ sort: "price" })).status).toBe(422);
    expect((await list({ page: "-1" })).status).toBe(422);
    expect((await list({ unknown: "1" })).status).toBe(422);

    const injection = await request(app).get("/api/timers?query[$ne]=x");
    expect(injection.status).toBe(422);
  });
});

describe("GET /api/timers/:id", () => {
  it("returns a timer", async () => {
    const timer = await insertTimer();
    const response = await request(app).get(`/api/timers/${timer.id}`);
    expect(response.status).toBe(200);
    expect(response.body.timer.id).toBe(timer.id);
  });

  it("hides other shops' timers", async () => {
    const timer = await insertTimer({ shop: OTHER_SHOP });
    const response = await request(app).get(`/api/timers/${timer.id}`);
    expect(response.status).toBe(404);
  });

  it("returns 404 for malformed IDs", async () => {
    const response = await request(app).get("/api/timers/not-an-id");
    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Timer not found.");
  });
});

describe("PUT /api/timers/:id", () => {
  it("replaces a timer", async () => {
    const created = (await createTimer()).body.timer;
    const response = await request(app)
      .put(`/api/timers/${created.id}`)
      .send(
        timerPayload({
          name: "Cyber Monday",
          size: "large",
          target: { type: "products", resourceIds: ["gid://shopify/Product/1001"] },
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body.timer).toMatchObject({
      id: created.id,
      name: "Cyber Monday",
      size: "large",
      target: { type: "products" },
    });
  });

  it("lets merchants rename an expired timer without changing its end", async () => {
    const timer = await insertTimer({
      startsAt: new Date("2026-06-01T04:00:00Z"),
      endsAt: new Date("2026-06-30T04:00:00Z"),
    });
    const payload = timerPayload({
      name: "Renamed",
      startDate: "2026-06-01",
      startTime: "00:00",
      endDate: "2026-06-30",
      endTime: "00:00",
    });

    const ok = await request(app).put(`/api/timers/${timer.id}`).send(payload);
    expect(ok.status).toBe(200);
    expect(ok.body.timer.status).toBe("expired");

    const moved = await request(app)
      .put(`/api/timers/${timer.id}`)
      .send({ ...payload, endDate: "2026-07-01" });
    expect(moved.status).toBe(422);
  });

  it("can't update another shop's timer", async () => {
    const timer = await insertTimer({ shop: OTHER_SHOP });
    const response = await request(app).put(`/api/timers/${timer.id}`).send(timerPayload());
    expect(response.status).toBe(404);
    expect((await Timer.findById(timer.id)).name).toBe("Seeded timer");
  });
});

describe("DELETE /api/timers/:id", () => {
  it("deletes a timer", async () => {
    const timer = await insertTimer();
    const response = await request(app).delete(`/api/timers/${timer.id}`);
    expect(response.status).toBe(204);
    expect(await Timer.countDocuments()).toBe(0);
  });

  it("can't delete another shop's timer", async () => {
    const timer = await insertTimer({ shop: OTHER_SHOP });
    const response = await request(app).delete(`/api/timers/${timer.id}`);
    expect(response.status).toBe(404);
    expect(await Timer.countDocuments()).toBe(1);
  });
});

describe("API safeguards", () => {
  it("rate-limits writes per shop", async () => {
    ({ app } = buildTestApp({ rateLimit: { max: 100, writeMax: 2 } }));

    expect((await createTimer()).status).toBe(201);
    expect((await createTimer()).status).toBe(201);
    const limited = await createTimer();

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.headers.ratelimit).toBeDefined();

    // Reads and other shops have their own budget.
    expect((await request(app).get("/api/timers")).status).toBe(200);
    expect((await createTimer(timerPayload(), OTHER_SHOP)).status).toBe(201);
  });

  it("returns 404 JSON for unknown API routes", async () => {
    const response = await request(app).get("/api/unknown");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("hides internal error details", async () => {
    const failingService = { list: vi.fn().mockRejectedValue(new Error("db password leaked")) };
    ({ app } = buildTestApp({ timerService: failingService }));

    const response = await request(app).get("/api/timers");
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });
});

describe("database setup", () => {
  it("creates the timer indexes at startup", async () => {
    const indexes = await Timer.collection.indexes();
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "shop_1_createdAt_-1",
        "shop_1_name_1",
        "shop_1_target.resources.id_1",
      ]),
    );
  });
});
