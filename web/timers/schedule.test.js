import { describe, expect, it } from "vitest";

import { ValidationError } from "../lib/errors.js";

import {
  isValidTimeZone,
  resolveSchedule,
  utcToZonedParts,
  zonedWallTimeToUtc,
} from "./schedule.js";

const ZONE = "America/New_York";
const NOW = new Date("2026-11-27T12:00:00Z");

function scheduleError(input, context = {}) {
  try {
    resolveSchedule(input, { zone: ZONE, now: NOW, ...context });
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.fields;
  }
  throw new Error("Expected a validation error");
}

describe("zonedWallTimeToUtc", () => {
  it("converts wall-clock time in the shop's zone to UTC", () => {
    expect(zonedWallTimeToUtc("2026-11-29", "00:00", ZONE)?.toISOString()).toBe(
      "2026-11-29T05:00:00.000Z",
    );
    expect(zonedWallTimeToUtc("2026-07-01", "12:00", ZONE)?.toISOString()).toBe(
      "2026-07-01T16:00:00.000Z",
    );
  });

  it("shifts times inside a daylight-saving gap forward", () => {
    // 02:30 doesn't exist on 2026-03-08 in New York; clocks jump to 03:00.
    expect(zonedWallTimeToUtc("2026-03-08", "02:30", ZONE)?.toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("returns null for invalid input", () => {
    expect(zonedWallTimeToUtc("2026-02-30", "10:00", ZONE)).toBeNull();
  });
});

describe("utcToZonedParts", () => {
  it("splits an instant into local date and time", () => {
    expect(utcToZonedParts(new Date("2026-11-29T04:59:00Z"), ZONE)).toEqual({
      date: "2026-11-28",
      time: "23:59",
    });
  });
});

describe("isValidTimeZone", () => {
  it("recognizes IANA zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("resolveSchedule", () => {
  const input = {
    startDate: "2026-11-29",
    startTime: "00:00",
    endDate: "2026-11-30",
    endTime: "23:59",
  };

  it("returns UTC instants", () => {
    const { startsAt, endsAt } = resolveSchedule(input, { zone: ZONE, now: NOW });
    expect(startsAt.toISOString()).toBe("2026-11-29T05:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-12-01T04:59:00.000Z");
  });

  it("starts immediately when no start is given", () => {
    const { startsAt } = resolveSchedule(
      { ...input, startDate: null, startTime: null },
      { zone: ZONE, now: NOW },
    );
    expect(startsAt).toEqual(NOW);
  });

  it("requires the end to be after the start", () => {
    expect(scheduleError({ ...input, endDate: "2026-11-28" })).toEqual({
      endDate: "End must be after the start date and time.",
    });
    expect(scheduleError({ ...input, endDate: "2026-11-29", endTime: "00:00" })).toEqual({
      endTime: "End must be after the start date and time.",
    });
  });

  it("requires the end to be in the future", () => {
    expect(
      scheduleError({
        startDate: "2026-11-01",
        startTime: "00:00",
        endDate: "2026-11-02",
        endTime: "00:00",
      }),
    ).toEqual({ endDate: "End must be in the future." });

    expect(
      scheduleError({ startDate: null, startTime: null, endDate: "2026-11-27", endTime: "06:00" }),
    ).toEqual({ endTime: "End must be in the future." });
  });

  it("allows an unchanged past end when editing an expired timer", () => {
    const past = {
      startDate: "2026-11-01",
      startTime: "00:00",
      endDate: "2026-11-02",
      endTime: "00:00",
    };
    const previousEndsAt = zonedWallTimeToUtc(past.endDate, past.endTime, ZONE);
    expect(() => resolveSchedule(past, { zone: ZONE, now: NOW, previousEndsAt })).not.toThrow();
  });
});
