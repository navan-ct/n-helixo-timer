import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  apiTimer,
  fakeFetch,
  MINUTE,
  NOW,
  resetVisibility,
  setVisibility,
} from "../../test/helpers.js";

import { now as clockNow } from "./clock.js";
import { getFeed } from "./feed.js";

const OPTIONS = {
  endpoint: "/apps/n-helixo-timer/timers",
  shop: "alpha-store.myshopify.com",
  productId: "1001",
  collectionIds: ["2001", "2002"],
};
const CACHE_KEY = "helixo-timer:alpha-store.myshopify.com:1001";

function subscribe(options = {}) {
  const states = [];
  const feed = getFeed({ ...OPTIONS, ...options });
  const unsubscribe = feed.subscribe((state) => states.push(state));
  return { feed, states, unsubscribe, latest: () => states.at(-1) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  resetVisibility();
});

describe("loading", () => {
  it("requests the product's timers and reports them", async () => {
    const fetch = fakeFetch();
    const { latest } = subscribe({ fetch });
    expect(latest().status).toBe("loading");

    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/apps/n-helixo-timer/timers");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product: "1001",
      collections: "2001,2002",
    });
    expect(latest()).toMatchObject({ status: "ready", timers: [{ id: "t1" }] });
  });

  it("shares one request between widgets for the same product", async () => {
    const fetch = fakeFetch();
    subscribe({ fetch });
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("corrects the countdown clock for a device that runs behind", async () => {
    // The shopper's clock is 5 minutes slow; the server knows the real time.
    const fetch = fakeFetch(() =>
      apiResponse([apiTimer()], { serverTime: new Date(NOW + 5 * MINUTE).toISOString() }),
    );
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    expect(clockNow() - Date.now()).toBe(5 * MINUTE);
  });
});

describe("caching", () => {
  it("renders from a fresh cache without a request", async () => {
    const first = fakeFetch();
    subscribe({ fetch: first }).unsubscribe();
    await vi.advanceTimersByTimeAsync(0);

    // A later page view, 30 seconds on.
    vi.setSystemTime(NOW + 30_000);
    const fetch = fakeFetch();
    const { latest } = subscribe({ fetch, productId: "1001", collectionIds: [] });

    expect(latest()).toMatchObject({ status: "ready", timers: [{ id: "t1" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();

    // ...and refreshes once the cached copy is a minute old.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows stale data immediately while it revalidates", async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        v: 1,
        savedAt: NOW - 10 * MINUTE,
        refreshMs: MINUTE,
        offset: 0,
        timers: [{ ...apiTimer({ id: "old" }) }],
      }),
    );
    const fetch = fakeFetch(() => apiResponse([apiTimer({ id: "new" })]));
    const { states } = subscribe({ fetch });

    expect(states[0]).toMatchObject({ status: "ready", timers: [{ id: "old" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ status: "ready", timers: [{ id: "new" }] });
  });

  it("ignores caches that are too old or corrupt", async () => {
    window.localStorage.setItem(CACHE_KEY, "{not json");
    const { latest } = subscribe({ fetch: fakeFetch(() => new Promise(() => {})) });
    expect(latest().status).toBe("loading");
  });

  it("doesn't use the cache in the theme editor", async () => {
    const fetch = fakeFetch();
    subscribe({ fetch, useCache: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("works when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { latest } = subscribe({ fetch: fakeFetch() });
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().status).toBe("ready");
  });
});

describe("polling", () => {
  it("refreshes on the interval the server asks for", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter
    const fetch = fakeFetch(() => apiResponse([apiTimer()], { refreshInterval: 120 }));
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("pauses while the tab is hidden and catches up when it's shown", async () => {
    const fetch = fakeFetch();
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't refetch when a hidden tab is shown again before its data is stale", async () => {
    const fetch = fakeFetch();
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the last widget goes away", async () => {
    const fetch = fakeFetch();
    const { unsubscribe } = subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("failures", () => {
  it("reports unavailable when the first request fails and nothing is cached", async () => {
    const { latest } = subscribe({
      fetch: fakeFetch(() => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toEqual({ status: "unavailable", timers: [] });
  });

  it("keeps known timers through failures and retries with backoff", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let failing = false;
    const fetch = fakeFetch(() => {
      if (failing) return [503, { error: { code: "UNAVAILABLE" } }];
      return apiResponse();
    });
    const { latest } = subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);

    failing = true;
    await vi.advanceTimersByTimeAsync(MINUTE); // scheduled refresh fails
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(latest()).toMatchObject({ status: "ready", timers: [{ id: "t1" }] });

    await vi.advanceTimersByTimeAsync(2_000); // 1st retry after 2s
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_999); // 2nd retry after 4s
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(4);

    failing = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(latest().status).toBe("ready");
  });

  it("honors Retry-After when rate limited", async () => {
    const fetch = fakeFetch(() => [429, { error: {} }, { "Retry-After": "60" }]);
    subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a non-JSON page (such as a storefront password page) as a failure", async () => {
    const { latest } = subscribe({ fetch: fakeFetch(() => [200, "<html>Enter password</html>"]) });
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().status).toBe("unavailable");
  });

  it("aborts requests that take too long", async () => {
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { latest } = subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(latest().status).toBe("unavailable");
  });

  it("retries as soon as the browser is back online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = fakeFetch();
    const { latest } = subscribe({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(latest().status).toBe("unavailable");

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe("ready");
  });
});
