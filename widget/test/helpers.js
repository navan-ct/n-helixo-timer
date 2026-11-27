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
