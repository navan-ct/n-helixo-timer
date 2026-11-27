import { now as clockNow, setOffset } from "./clock.js";
import { resolveEvergreenTimers } from "./evergreen.js";
import { readJson, writeJson } from "./storage.js";
import {
  DEFAULT_REFRESH_SECONDS,
  orderTimers,
  parseTimer,
  parseTimersResponse,
} from "./timer-data.js";

/**
 * Keeps the timers for one product up to date, as cheaply as possible.
 *
 * - Cache: each response is saved to localStorage, so later page views (and
 *   other tabs) render instantly and skip the request while it's fresh. Stale
 *   data is still shown while a fresh copy loads (stale-while-revalidate).
 * - Polling: refreshes on the interval the server asks for (with jitter, so
 *   shoppers don't poll in lockstep), only while the page is visible. A hidden
 *   tab refreshes when it's shown again, if its data went stale meanwhile.
 * - Failures: a slow request is aborted, and failed requests are retried with
 *   exponential backoff (honoring Retry-After), or as soon as the browser is
 *   back online. Known timers keep counting down throughout, since the
 *   countdown only needs their end time.
 * - Sharing: every widget for the same product on a page shares one feed.
 * - Evergreen timers: each one gets this shopper's start and end
 *   (core/evergreen.js) before it's reported, so listeners only ever see
 *   timers with a start and an end, in the order they take the block.
 *
 * Feed states:
 * - `loading`: nothing to show yet (first request in flight, nothing cached)
 * - `ready`: `timers` are known (possibly from cache while revalidating)
 * - `unavailable`: the request failed and nothing is cached
 */

// 2: timers carry a type-specific period and a priority (evergreen timers).
const CACHE_VERSION = 2;
const CACHE_PREFIX = "helixo-timer:";
/** Cached data older than this isn't shown, even while offline. */
const MAX_CACHE_AGE_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;

const jitter = (ms, spread) => ms * (1 - spread + Math.random() * spread * 2);

function retryDelay(failures, retryAfterMs) {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
  return Math.max(jitter(backoff, 0.25), retryAfterMs);
}

function retryAfter(response) {
  const seconds = Number(response.headers?.get?.("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, RETRY_MAX_MS) : 0;
}

class RequestError extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * @param {{
 *   endpoint: string,
 *   shop: string,
 *   productId: string,
 *   collectionIds: string[],
 *   useCache: boolean,
 *   fetch: typeof fetch,
 * }} options
 */
function createFeed({ endpoint, shop, productId, collectionIds, useCache, fetch }) {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("product", productId);
  if (collectionIds.length) url.searchParams.set("collections", collectionIds.join(","));
  const cacheKey = `${CACHE_PREFIX}${shop}:${productId}`;

  const listeners = new Set();
  let state = { status: "loading", timers: [] };
  let running = false;
  let fetchedAt = 0;
  let refreshMs = DEFAULT_REFRESH_SECONDS * 1000;
  let failures = 0;
  let refreshTimeout = null;
  let controller = null;

  function emit(next) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  /** Reports timers from the API or the cache, with evergreen timers resolved for this shopper. */
  function emitTimers(timers) {
    const resolved = resolveEvergreenTimers(timers, { shop, now: clockNow(), persist: useCache });
    emit({ status: "ready", timers: orderTimers(resolved) });
  }

  const isStale = () => Date.now() - fetchedAt >= refreshMs;

  /** Takes newer data from the cache, written by an earlier page view or another tab. */
  function adoptCache() {
    if (!useCache) return false;
    const entry = readJson(cacheKey);
    if (
      entry?.v !== CACHE_VERSION ||
      !Array.isArray(entry.timers) ||
      !Number.isFinite(entry.savedAt) ||
      entry.savedAt <= fetchedAt
    ) {
      return false;
    }
    const age = Date.now() - entry.savedAt;
    if (age < 0 || age > MAX_CACHE_AGE_MS) return false;

    fetchedAt = entry.savedAt;
    if (Number.isFinite(entry.refreshMs)) refreshMs = entry.refreshMs;
    setOffset(entry.offset);
    emitTimers(entry.timers.map(parseTimer).filter(Boolean));
    return true;
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(refreshIfVisible, Math.max(0, delay));
  }

  function refreshIfVisible() {
    // A hidden tab waits; `onVisible` refreshes it when it's shown again.
    if (document.visibilityState === "hidden") return;
    refresh();
  }

  function refresh() {
    if (!running || controller) return;
    // Another tab may have refreshed this product in the meantime.
    adoptCache();
    if (!isStale() && failures === 0) {
      scheduleRefresh(fetchedAt + refreshMs - Date.now());
      return;
    }
    load();
  }

  async function load() {
    clearTimeout(refreshTimeout);
    if (navigator.onLine === false) {
      fail(new RequestError("offline"));
      return;
    }

    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    const sentAt = Date.now();

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: request.signal,
      });
      if (!response.ok) {
        throw new RequestError(`HTTP ${response.status}`, retryAfter(response));
      }
      // A storefront password page or an app proxy misconfiguration returns HTML.
      const data = parseTimersResponse(await response.json());
      if (!data) throw new RequestError("Unexpected response");

      const receivedAt = Date.now();
      // Estimate the device clock error against the server, halfway through the round trip.
      const offset = Number.isFinite(data.serverTime)
        ? data.serverTime - (sentAt + receivedAt) / 2
        : 0;
      setOffset(offset);

      failures = 0;
      fetchedAt = receivedAt;
      refreshMs = data.refreshInterval * 1000;
      if (useCache) {
        writeJson(cacheKey, {
          v: CACHE_VERSION,
          savedAt: receivedAt,
          refreshMs,
          offset,
          timers: data.timers,
        });
      }
      if (running) {
        emitTimers(data.timers);
        scheduleRefresh(jitter(refreshMs, 0.1));
      }
    } catch (error) {
      if (running) fail(error);
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = null;
    }
  }

  function fail(error) {
    failures += 1;
    // Keep showing what's known; only report "unavailable" when there's nothing.
    if (state.status === "loading") emit({ status: "unavailable", timers: [] });
    scheduleRefresh(retryDelay(failures, error?.retryAfterMs ?? 0));
  }

  function onVisible() {
    if (document.visibilityState === "visible" && (isStale() || failures > 0)) refresh();
  }

  function onOnline() {
    if (failures > 0) refresh();
  }

  function onPageShow(event) {
    // Restored from the back/forward cache: timers may have changed meanwhile.
    if (event.persisted) onVisible();
  }

  function start() {
    running = true;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    adoptCache();
    if (state.status === "ready" && !isStale()) {
      scheduleRefresh(fetchedAt + refreshMs - Date.now());
    } else {
      load();
    }
  }

  function stop() {
    running = false;
    clearTimeout(refreshTimeout);
    controller?.abort();
    controller = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pageshow", onPageShow);
  }

  return {
    getState: () => state,
    /**
     * @param {(state: { status: string, timers: import("./timer-data.js").Timer[] }) => void} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener);
      if (!running) start();
      listener(state);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && running) stop();
      };
    },
  };
}

const feeds = new Map();

/**
 * Returns the shared feed for a product, creating it on first use. A feed runs
 * while it has subscribers and keeps its last state when it stops.
 * @param {{ endpoint: string, shop: string, productId: string, collectionIds: string[],
 *   useCache?: boolean, fetch?: typeof fetch }} options
 */
export function getFeed({ useCache = true, fetch = window.fetch.bind(window), ...options }) {
  const key = [options.endpoint, options.productId, options.collectionIds.join(","), useCache].join(
    "|",
  );
  let feed = feeds.get(key);
  if (!feed) {
    feed = createFeed({ ...options, useCache, fetch });
    feeds.set(key, feed);
  }
  return feed;
}

/** Test helper: forget all feeds. */
export function resetFeeds() {
  feeds.clear();
}
