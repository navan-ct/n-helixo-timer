import { describe, expect, it, vi } from "vitest";

import { UpstreamError, ValidationError } from "../lib/errors.js";
import { silentLogger as logger } from "../lib/logger.js";
import { CATALOG, createFakeGraphqlClient } from "../test/helpers.js";

import { createShopifyAdminApi } from "./admin-api.js";

const session = { shop: "alpha-store.myshopify.com" };

describe("createShopifyAdminApi", () => {
  it("caches the shop time zone for an hour", async () => {
    const client = createFakeGraphqlClient({ timezone: "Asia/Kolkata" });
    const request = vi.spyOn(client, "request");
    let now = 0;
    const api = createShopifyAdminApi({ createClient: () => client, logger, now: () => now });

    expect(await api.getShopTimezone(session)).toBe("Asia/Kolkata");
    expect(await api.getShopTimezone(session)).toBe("Asia/Kolkata");
    expect(request).toHaveBeenCalledTimes(1);

    now = 60 * 60 * 1000 + 1;
    await api.getShopTimezone(session);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("falls back to UTC for an unknown time zone", async () => {
    const api = createShopifyAdminApi({
      createClient: () => createFakeGraphqlClient({ timezone: "Nowhere/Special" }),
      logger,
    });
    expect(await api.getShopTimezone(session)).toBe("UTC");
  });

  it("maps products and collections to stored resources", async () => {
    const api = createShopifyAdminApi({ createClient: () => createFakeGraphqlClient(), logger });

    await expect(
      api.resolveTargetResources(session, "products", ["gid://shopify/Product/1001"]),
    ).resolves.toEqual([
      {
        id: "gid://shopify/Product/1001",
        title: "Snowboard",
        handle: "snowboard",
        imageUrl: "https://cdn.test/snowboard.png",
        imageAlt: "Board",
      },
    ]);

    await expect(
      api.resolveTargetResources(session, "collections", ["gid://shopify/Collection/2001"]),
    ).resolves.toEqual([
      {
        id: "gid://shopify/Collection/2001",
        title: CATALOG["gid://shopify/Collection/2001"].title,
        handle: "winter-sale",
        imageUrl: "https://cdn.test/winter.png",
        imageAlt: "",
      },
    ]);
  });

  it("rejects missing resources and resources of the wrong type", async () => {
    const api = createShopifyAdminApi({ createClient: () => createFakeGraphqlClient(), logger });

    const error = await api
      .resolveTargetResources(session, "collections", [
        "gid://shopify/Collection/404",
        "gid://shopify/Collection/2001",
      ])
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fields["target.resourceIds"]).toMatch(/One of the selected items/);
  });

  it("skips the API call when there's nothing to resolve", async () => {
    const createClient = vi.fn();
    const api = createShopifyAdminApi({ createClient, logger });
    expect(await api.resolveTargetResources(session, "products", [])).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("wraps transport and GraphQL errors", async () => {
    const failing = createShopifyAdminApi({
      createClient: () => createFakeGraphqlClient({ fail: true }),
      logger,
    });
    await expect(failing.getShopTimezone(session)).rejects.toBeInstanceOf(UpstreamError);

    const graphqlErrors = createShopifyAdminApi({
      createClient: () => ({ request: async () => ({ errors: [{ message: "Throttled" }] }) }),
      logger,
    });
    await expect(graphqlErrors.getShopTimezone(session)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("bounds each request with a timeout and retries", async () => {
    const request = vi.fn(async () => ({ data: { shop: { ianaTimezone: "UTC" } } }));
    const api = createShopifyAdminApi({
      createClient: () => ({ request }),
      logger,
      timeoutMs: 5_000,
      retries: 3,
    });

    await api.getShopTimezone(session);

    const [, options] = request.mock.calls[0];
    expect(options.retries).toBe(3);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports timeouts as 504", async () => {
    const api = createShopifyAdminApi({
      createClient: () => ({
        request: (_query, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
          }),
      }),
      logger,
      timeoutMs: 20,
    });

    const error = await api.getShopTimezone(session).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 504, code: "SHOPIFY_TIMEOUT" });
  });
});
