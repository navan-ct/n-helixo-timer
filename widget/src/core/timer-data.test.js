import { describe, expect, it } from "vitest";

import { apiEvergreenTimer, apiResponse, apiTimer, HOUR, NOW } from "../../test/helpers.js";

import {
  orderTimers,
  parseTimer,
  parseTimersResponse,
  readableTextColor,
  runningTimer,
  splitDuration,
} from "./timer-data.js";

describe("parseTimer", () => {
  it("converts API timers to epoch times", () => {
    expect(parseTimer(apiTimer())).toEqual({
      id: "t1",
      type: "countdown",
      startsAt: NOW - HOUR,
      endsAt: NOW + 2 * HOUR,
      message: "Winter sale ends in",
      color: "#008060",
      size: "medium",
      urgency: "color_pulse",
      priority: 0,
    });
  });

  it("keeps an evergreen timer's duration, which has no fixed start or end", () => {
    expect(parseTimer(apiEvergreenTimer({ priority: 3 }))).toEqual({
      id: "e1",
      type: "evergreen",
      durationMinutes: 90,
      message: "Your welcome offer ends in",
      color: "#2c6ecb",
      size: "medium",
      urgency: "color_pulse",
      priority: 3,
    });
  });

  it.each([
    ["no duration", { durationMinutes: undefined }],
    ["a duration that isn't whole minutes", { durationMinutes: 1.5 }],
    ["a zero duration", { durationMinutes: 0 }],
    ["a duration over 365 days", { durationMinutes: 365 * 24 * 60 + 1 }],
  ])("drops evergreen timers with %s", (_label, overrides) => {
    expect(parseTimer(apiEvergreenTimer(overrides))).toBeNull();
  });

  it("round-trips its own output, as the cache stores it", () => {
    for (const raw of [apiTimer({ priority: 2 }), apiEvergreenTimer()]) {
      const parsed = parseTimer(raw);
      expect(parseTimer(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });

  it.each([
    ["no id", { id: 7 }],
    ["an unknown timer type", { type: "evergreen-v9" }],
    ["an invalid date", { endsAt: "soon" }],
    ["an end before the start", { endsAt: new Date(NOW - 2 * HOUR).toISOString() }],
  ])("drops timers with %s", (_label, overrides) => {
    expect(parseTimer(apiTimer(overrides))).toBeNull();
  });

  it("falls back to safe display values", () => {
    expect(
      parseTimer(apiTimer({ color: "red;background:url(x)", size: "huge", urgency: "explode" })),
    ).toMatchObject({ color: "#008060", size: "medium", urgency: "none" });
  });
});

describe("parseTimersResponse", () => {
  it("keeps valid timers and clamps the refresh interval", () => {
    const parsed = parseTimersResponse(
      apiResponse([apiTimer(), { id: "bad" }], { refreshInterval: 1 }),
    );
    expect(parsed.timers).toHaveLength(1);
    expect(parsed.refreshInterval).toBe(15);
  });

  it("rejects responses that aren't timer lists", () => {
    expect(parseTimersResponse(null)).toBeNull();
    expect(parseTimersResponse({ error: { code: "NOPE" } })).toBeNull();
  });
});

describe("orderTimers", () => {
  const at = (id, priority, endsAt) => ({ id, priority, startsAt: NOW - HOUR, endsAt });

  it("puts more specific targeting first, then the timer that ends soonest", () => {
    const ordered = orderTimers([
      at("all-late", 1, NOW + 5 * HOUR),
      at("all-soon", 1, NOW + HOUR),
      at("product", 3, NOW + 9 * HOUR),
      at("collection", 2, NOW + 2 * HOUR),
    ]);
    expect(ordered.map(({ id }) => id)).toEqual(["product", "collection", "all-soon", "all-late"]);
  });

  it("keeps the API's order for ties", () => {
    const ordered = orderTimers([at("b", 1, NOW + HOUR), at("a", 1, NOW + HOUR)]);
    expect(ordered.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});

describe("runningTimer", () => {
  const first = parseTimer(apiTimer({ id: "a" }));
  const upcoming = parseTimer(apiTimer({ id: "b", startsAt: new Date(NOW + HOUR).toISOString() }));

  it("returns the first timer in priority order that is running", () => {
    expect(runningTimer([upcoming, first], NOW).id).toBe("a");
  });

  it("switches at the exact start and end times", () => {
    expect(runningTimer([upcoming], NOW + HOUR - 1)).toBeNull();
    expect(runningTimer([upcoming], NOW + HOUR).id).toBe("b");
    expect(runningTimer([first], first.endsAt)).toBeNull();
  });
});

describe("splitDuration", () => {
  it("splits milliseconds into units and never goes negative", () => {
    expect(splitDuration(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
    expect(splitDuration(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("readableTextColor", () => {
  it("picks white on dark colors and near-black on light ones", () => {
    expect(readableTextColor("#008060")).toBe("#ffffff");
    expect(readableTextColor("#ffd966")).toBe("#1a1a1a");
  });
});
