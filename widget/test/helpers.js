import { vi } from "vitest";

export const NOW = Date.parse("2026-11-27T12:00:00.000Z");
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** A timer as the storefront API sends it. */
export function apiTimer(overrides = {}) {
  return {
    id: "t1",
    type: "countdown",
    startsAt: new Date(NOW - HOUR).toISOString(),
    endsAt: new Date(NOW + 2 * HOUR).toISOString(),
    message: "Winter sale ends in",
    color: "#008060",
    size: "medium",
    urgency: "color_pulse",
    ...overrides,
  };
}

/** An evergreen timer as the storefront API sends it. */
export function apiEvergreenTimer(overrides = {}) {
  return {
    id: "e1",
    type: "evergreen",
    durationMinutes: 90,
    message: "Your welcome offer ends in",
    color: "#2c6ecb",
    size: "medium",
    urgency: "color_pulse",
    priority: 1,
    ...overrides,
  };
}

export function apiResponse(timers = [apiTimer()], overrides = {}) {
  return {
    timers,
    serverTime: new Date(Date.now()).toISOString(),
    refreshInterval: 60,
    ...overrides,
  };
}

/**
 * A fetch stand-in. `handler` returns a body (200), a [status, body, headers]
 * tuple, or throws to simulate a network error.
 */
export function fakeFetch(handler = () => apiResponse()) {
  return vi.fn(async (url, init) => {
    const result = await handler(url, init);
    const [status, body, headers] = Array.isArray(result) ? result : [200, result, {}];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  });
}

let visibility = "visible";
/** Simulates the tab being hidden or shown, firing visibilitychange. */
export function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibility,
});

export function resetVisibility() {
  visibility = "visible";
}

/**
 * Replaces IntersectionObserver with one the test drives: `setRatio(r)` reports
 * that fraction of every observed element as on screen. Undo with
 * `vi.unstubAllGlobals()`.
 */
export function stubIntersectionObserver() {
  const observers = new Set();
  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      observers.add(this);
    }

    observe(target) {
      this.targets.add(target);
    }

    unobserve(target) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  return {
    setRatio(ratio) {
      for (const observer of [...observers]) {
        const entries = [...observer.targets].map((target) => ({
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        }));
        if (entries.length) observer.callback(entries, observer);
      }
    },
    /** How many elements are being watched. */
    observed: () => [...observers].reduce((total, observer) => total + observer.targets.size, 0),
  };
}

/**
 * Stands in for Shopify's Customer Privacy API on the storefront. `allowed`
 * answers `analyticsProcessingAllowed()`; pass `loaded: false` to make the
 * widget load it with `Shopify.loadFeatures`. Undo with `delete window.Shopify`.
 */
export function stubCustomerPrivacy({ allowed = true, loaded = true } = {}) {
  const state = { allowed };
  const customerPrivacy = { analyticsProcessingAllowed: vi.fn(() => state.allowed) };
  const loadFeatures = vi.fn((features, callback) => {
    window.Shopify.customerPrivacy = customerPrivacy;
    callback(null);
  });
  window.Shopify = { loadFeatures, ...(loaded && { customerPrivacy }) };
  return {
    loadFeatures,
    customerPrivacy,
    setAllowed(value) {
      state.allowed = value;
    },
  };
}
