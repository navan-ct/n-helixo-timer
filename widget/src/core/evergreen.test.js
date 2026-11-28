import { describe, expect, it, vi } from "vitest";

import { apiEvergreenTimer, apiTimer, HOUR, MINUTE, NOW } from "../../test/helpers.js";

import { MAX_REMEMBERED_STARTS, resetEvergreen, resolveEvergreenTimers } from "./evergreen.js";
import { parseTimer } from "./timer-data.js";

const SHOP = "alpha-store.myshopify.com";
const STORAGE_KEY = `helixo-timer:evergreen:${SHOP}`;
const evergreen = (overrides) => parseTimer(apiEvergreenTimer(overrides));
const resolve = (timers, options = {}) =>
  resolveEvergreenTimers(timers, { shop: SHOP, now: NOW, persist: true, ...options });

/** A later page view: the page's memory is gone, only storage is left. */
function newPageView() {
  resetEvergreen();
}

describe("resolveEvergreenTimers", () => {
  it("starts an evergreen timer the first time the shopper gets it", () => {
    const [timer] = resolve([evergreen({ durationMinutes: 90 })]);
    expect(timer).toMatchObject({ id: "e1", startsAt: NOW, endsAt: NOW + 90 * MINUTE });
  });

  it("keeps the shopper's start on later page views", () => {
    resolve([evergreen()]);
    newPageView();

    const [timer] = resolve([evergreen()], { now: NOW + 20 * MINUTE });

    expect(timer).toMatchObject({ startsAt: NOW, endsAt: NOW + 90 * MINUTE });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual({
      v: 1,
      starts: { e1: NOW },
    });
  });

  it("stays ended for the shopper once it has run out", () => {
    resolve([evergreen({ durationMinutes: 30 })]);
    newPageView();

    const [timer] = resolve([evergreen({ durationMinutes: 30 })], { now: NOW + 2 * HOUR });

    expect(timer.endsAt).toBe(NOW + 30 * MINUTE);
  });

  it("follows a new duration from the shopper's original start", () => {
    resolve([evergreen({ durationMinutes: 30 })]);
    const [timer] = resolve([evergreen({ durationMinutes: 60 })], { now: NOW + MINUTE });
    expect(timer).toMatchObject({ startsAt: NOW, endsAt: NOW + HOUR });
  });

  it("starts each evergreen timer separately and leaves countdowns as they are", () => {
    resolve([evergreen({ id: "a" })]);
    const countdown = parseTimer(apiTimer());

    const [a, b, passed] = resolve([evergreen({ id: "a" }), evergreen({ id: "b" }), countdown], {
      now: NOW + 10 * MINUTE,
    });

    expect(a.startsAt).toBe(NOW);
    expect(b.startsAt).toBe(NOW + 10 * MINUTE);
    expect(passed).toBe(countdown);
  });

  it("keeps starts separate for each shop", () => {
    resolve([evergreen()]);
    const [timer] = resolve([evergreen()], { shop: "beta.myshopify.com", now: NOW + HOUR });
    expect(timer.startsAt).toBe(NOW + HOUR);
  });

  it("uses the earliest start when another tab started the timer too", () => {
    resolve([evergreen()], { now: NOW + 5_000 });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, starts: { e1: NOW } }));

    const [timer] = resolve([evergreen()], { now: NOW + MINUTE });

    expect(timer.startsAt).toBe(NOW);
  });

  it("counts from now when a stored start is in the future (the device clock moved back)", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, starts: { e1: NOW + HOUR } }));
    const [timer] = resolve([evergreen({ durationMinutes: 90 })]);
    expect(timer).toMatchObject({ startsAt: NOW, endsAt: NOW + 90 * MINUTE });
  });

  it("ignores malformed stored starts", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, starts: { e1: "yesterday" } }));
    expect(resolve([evergreen()])[0].startsAt).toBe(NOW);

    window.localStorage.setItem(STORAGE_KEY, "{not json");
    newPageView();
    expect(resolve([evergreen()], { now: NOW + MINUTE })[0].startsAt).toBe(NOW + MINUTE);
  });

  it("doesn't store starts in the theme editor, but keeps them for the page", () => {
    resolve([evergreen()], { persist: false });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    const [timer] = resolve([evergreen()], { persist: false, now: NOW + MINUTE });
    expect(timer.startsAt).toBe(NOW);
  });

  it("still counts down for the page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    resolve([evergreen()]);
    const [timer] = resolve([evergreen()], { now: NOW + MINUTE });

    expect(timer.startsAt).toBe(NOW);
  });

  it("forgets the oldest starts first, never those of the timers on the page", () => {
    const starts = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_STARTS }, (_, index) => [`old-${index}`, NOW - index]),
    );
    // The oldest stored start belongs to a timer that's on the page again.
    starts.current = NOW - 10 * HOUR;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, starts }));

    resolve([evergreen({ id: "current" }), evergreen({ id: "new" })]);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)).starts;
    expect(Object.keys(stored)).toHaveLength(MAX_REMEMBERED_STARTS);
    expect(stored).toMatchObject({ current: NOW - 10 * HOUR, new: NOW });
    expect(stored).not.toHaveProperty(`old-${MAX_REMEMBERED_STARTS - 1}`);
  });
});
