import { describe, expect, it } from "vitest";

import { formatNumber, percentChange } from "./format";

describe("formatNumber", () => {
  it("groups digits for the locale", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(0, "en")).toBe("0");
  });
});

describe("percentChange", () => {
  it("rounds the change to a whole percent", () => {
    expect(percentChange(112, 100, "en")).toEqual({ direction: "up", percent: "12%" });
    expect(percentChange(26589, 23710, "en")).toEqual({ direction: "up", percent: "12%" });
    expect(percentChange(23, 100, "en")).toEqual({ direction: "down", percent: "77%" });
    expect(percentChange(300, 100, "en")).toEqual({ direction: "up", percent: "200%" });
  });

  it("calls a change that rounds to 0% no change", () => {
    expect(percentChange(100, 100, "en")).toEqual({ direction: "none", percent: "0%" });
    expect(percentChange(1001, 1000, "en")).toEqual({ direction: "none", percent: "0%" });
  });

  it("has nothing to compare with when the previous period is empty", () => {
    expect(percentChange(40, 0, "en")).toBeNull();
    expect(percentChange(0, 0, "en")).toBeNull();
  });
});
