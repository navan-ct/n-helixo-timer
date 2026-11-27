import { describe, expect, it } from "vitest";

import { apiResponse, apiTimer, HOUR, NOW } from "../../test/helpers.js";

import {
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
    });
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
