import { describe, expect, it } from "vitest";

import {
  formatTimeOfDay,
  nowInTimeZone,
  parseTimeInput,
  splitDuration,
  zonedWallTimeToEpoch,
} from "./time";

describe("parseTimeInput", () => {
  it.each([
    ["9", "09:00"],
    ["9:30", "09:30"],
    ["0930", "09:30"],
    ["9.30", "09:30"],
    ["21:30", "21:30"],
    ["9:30pm", "21:30"],
    ["9:30 PM", "21:30"],
    ["9:30 p.m.", "21:30"],
    ["12am", "00:00"],
    ["12:15 am", "00:15"],
    ["12 pm", "12:00"],
    ["  7 AM ", "07:00"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
  ])("parses %j as %s", (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });

  it("returns an empty string for blank input", () => {
    expect(parseTimeInput("")).toBe("");
    expect(parseTimeInput("   ")).toBe("");
    expect(parseTimeInput(undefined)).toBe("");
  });

  it.each(["24:00", "9:60", "13pm", "0am", "noon", "9:3", "1234567"])("rejects %j", (input) => {
    expect(parseTimeInput(input)).toBeNull();
  });
});

describe("formatTimeOfDay", () => {
  it("uses the locale's clock", () => {
    expect(formatTimeOfDay("21:30", "en-US")).toBe("9:30 PM");
    expect(formatTimeOfDay("21:30", "de")).toBe("21:30");
  });

  it("leaves unparseable input untouched", () => {
    expect(formatTimeOfDay("soon", "en-US")).toBe("soon");
  });
});

describe("nowInTimeZone", () => {
  it("returns the wall-clock date and time in a zone", () => {
    const instant = new Date("2026-11-27T03:30:00Z");
    expect(nowInTimeZone("America/New_York", instant)).toEqual({
      date: "2026-11-26",
      time: "22:30",
    });
    expect(nowInTimeZone("Asia/Kolkata", instant)).toEqual({ date: "2026-11-27", time: "09:00" });
  });
});

describe("zonedWallTimeToEpoch", () => {
  it("converts wall-clock time in a zone to a UTC timestamp", () => {
    expect(zonedWallTimeToEpoch("2026-11-29", "12:00 AM", "America/New_York")).toBe(
      Date.parse("2026-11-29T05:00:00Z"),
    );
    expect(zonedWallTimeToEpoch("2026-07-01", "12:00", "America/New_York")).toBe(
      Date.parse("2026-07-01T16:00:00Z"),
    );
  });

  it("returns null for incomplete input", () => {
    expect(zonedWallTimeToEpoch("", "10:00", "UTC")).toBeNull();
    expect(zonedWallTimeToEpoch("2026-11-29", "", "UTC")).toBeNull();
  });
});

describe("splitDuration", () => {
  it("splits milliseconds into days, hours, minutes and seconds", () => {
    expect(splitDuration(((26 * 60 + 3) * 60 + 4) * 1000)).toEqual({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
    });
  });

  it("never returns negative values", () => {
    expect(splitDuration(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
