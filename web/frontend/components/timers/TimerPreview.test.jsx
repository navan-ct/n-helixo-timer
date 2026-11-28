import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimerPreview } from "./TimerPreview";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const HOUR = 3_600_000;

/** The digits on screen per unit, ignoring glyphs that are rolling out. */
const digits = (container) =>
  [...container.querySelectorAll(".timer-preview__value")].map((unit) =>
    [...unit.querySelectorAll(".timer-preview__glyph:not(.timer-preview__glyph--out)")]
      .map((glyph) => glyph.textContent)
      .join(""),
  );

const bar = (container) => container.querySelector(".timer-preview__bar");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimerPreview", () => {
  it("shows the timer first, above the product information down to the Buy button", () => {
    const { container } = render(<TimerPreview color="#008060" size="medium" urgency="none" />);

    const page = container.querySelector(".timer-preview__page");
    expect(page.firstElementChild).toHaveClass("timer-preview__bar");
    expect(
      [...page.querySelector(".timer-preview__details").children].map((child) => child.className),
    ).toEqual([
      "timer-preview__line timer-preview__line--title",
      "timer-preview__line timer-preview__line--price",
      "timer-preview__button",
    ]);
  });

  it("shows the timer with its color, size and message", () => {
    const { container } = render(
      <TimerPreview
        color="#ffd966"
        size="large"
        urgency="none"
        description={"Winter sale\nends soon"}
        endsAt={NOW + 26 * HOUR + 5 * 60_000 + 3_000}
      />,
    );

    expect(bar(container)).toHaveClass("timer-preview__bar--large");
    expect(bar(container).style.getPropertyValue("--timer-color")).toBe("#ffd966");
    expect(bar(container).style.getPropertyValue("--timer-text")).toBe("#1a1a1a");
    expect(container.querySelector(".timer-preview__message").textContent).toBe(
      "Winter sale\nends soon",
    );
    expect(digits(container)).toEqual(["01", "02", "05", "03"]);
  });

  it("counts down on each second and rolls the digits that change", async () => {
    const { container } = render(
      <TimerPreview color="#008060" size="medium" urgency="none" endsAt={NOW + 10_000} />,
    );
    expect(digits(container).at(-1)).toBe("10");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_010);
    });

    expect(digits(container).at(-1)).toBe("09");
    const rolling = [...container.querySelectorAll(".timer-preview__glyph--out")].map(
      (glyph) => glyph.textContent,
    );
    expect(rolling).toEqual(expect.arrayContaining(["1", "0"]));
  });

  it("loops the chosen urgency effect", () => {
    const { container } = render(
      <TimerPreview color="#008060" size="medium" urgency="shake" endsAt={NOW + 48 * HOUR} />,
    );
    expect(bar(container)).toHaveClass("timer-preview__bar--shake");
  });

  it("shows a sample with the default message before an end is set", () => {
    const { container } = render(<TimerPreview color="#008060" size="small" urgency="none" />);
    expect(container.querySelector(".timer-preview__message")).toHaveTextContent("Sale ends in");
    expect(digits(container)).toEqual(["02", "14", "33", "12"]);
  });

  it("shows the ended state for an end in the past", () => {
    const { container } = render(
      <TimerPreview color="#008060" size="medium" urgency="shake" endsAt={NOW - HOUR} />,
    );
    expect(bar(container)).toHaveClass("timer-preview__bar--ended");
    expect(bar(container)).not.toHaveClass("timer-preview__bar--shake");
    expect(container.querySelector(".timer-preview__message")).toHaveTextContent(
      "This offer has ended",
    );
    expect(digits(container)).toEqual(["00", "00", "00", "00"]);
  });

  it("fills the progress line from the start time", () => {
    const { container } = render(
      <TimerPreview
        color="#008060"
        size="medium"
        urgency="none"
        startsAt={NOW - 3 * HOUR}
        endsAt={NOW + HOUR}
      />,
    );
    expect(container.querySelector(".timer-preview__progress > span").style.transform).toBe(
      "scaleX(0.25)",
    );
  });

  it("shows a full progress line for a timer that starts now", () => {
    const { container } = render(
      <TimerPreview color="#008060" size="medium" urgency="none" endsAt={NOW + HOUR} />,
    );
    expect(container.querySelector(".timer-preview__progress > span").style.transform).toBe(
      "scaleX(1)",
    );
  });

  describe("evergreen duration", () => {
    const progress = (container) =>
      container.querySelector(".timer-preview__progress > span").style.transform;
    const preview = (duration) => (
      <TimerPreview color="#008060" size="medium" urgency="none" duration={duration} />
    );

    it("plays the full duration from now, as for a shopper arriving now", async () => {
      const { container } = render(preview(90 * 60_000));
      expect(digits(container)).toEqual(["00", "01", "30", "00"]);
      expect(progress(container)).toBe("scaleX(1)");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45 * 60_000 + 10);
      });
      expect(digits(container)).toEqual(["00", "00", "45", "00"]);
      // The clock ticks a few milliseconds past each second.
      expect(Number(/scaleX\((.+)\)/.exec(progress(container))[1])).toBeCloseTo(0.5, 4);
    });

    it("starts over when the duration changes", async () => {
      const { container, rerender } = render(preview(HOUR));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 10);
      });
      expect(digits(container)).toEqual(["00", "00", "50", "00"]);

      rerender(preview(2 * HOUR));
      expect(digits(container)).toEqual(["00", "02", "00", "00"]);
      expect(progress(container)).toBe("scaleX(1)");
    });
  });
});
