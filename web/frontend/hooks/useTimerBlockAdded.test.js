import { describe, expect, it } from "vitest";

import { isTimerBlockAdded } from "./useTimerBlockAdded";

const block = (status, handle = "timer") => ({
  handle,
  name: "Timer",
  target: "section",
  status,
  activations: [],
});
const themeExtension = (...activations) => ({
  handle: "timer-widget",
  type: "theme_app_extension",
  activations,
});

describe("isTimerBlockAdded", () => {
  it("is true only when the Timer block is active on the published theme", () => {
    expect(isTimerBlockAdded([themeExtension(block("active"))])).toBe(true);
    expect(isTimerBlockAdded([themeExtension(block("available"))])).toBe(false);
    expect(isTimerBlockAdded([themeExtension(block("unavailable"))])).toBe(false);
  });

  it("ignores other blocks and other kinds of extensions", () => {
    const others = [
      {
        handle: "admin-action",
        type: "ui_extension",
        activations: [{ target: "admin.product-details.action.render" }],
      },
      themeExtension(block("active", "star_rating"), block("available")),
    ];
    expect(isTimerBlockAdded(others)).toBe(false);
  });

  it("is false without the extension", () => {
    expect(isTimerBlockAdded([])).toBe(false);
  });
});
