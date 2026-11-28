import { act, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiEvergreenTimer,
  apiTimer,
  HOUR,
  MINUTE,
  NOW,
  resetVisibility,
  setVisibility,
  stubIntersectionObserver,
} from "../../test/helpers.js";
import * as clock from "../core/clock.js";
import { parseTimer } from "../core/timer-data.js";

import { TimerWidget } from "./TimerWidget.jsx";

const STRINGS = {
  message: "Sale ends in",
  ended: "This offer has ended",
  days: "Days",
  hours: "Hrs",
  minutes: "Min",
  seconds: "Sec",
  editorEmpty: "No timer is running for this product.",
  editorUnavailable: "Timers couldn't be loaded.",
};
const CONFIG = { designMode: false, visualPreview: false, strings: STRINGS };

/** A controllable feed, like core/feed.js exposes. */
function fakeFeed(initial = { status: "ready", timers: [] }) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    push(next) {
      state = next;
      listeners.forEach((listener) => listener(state));
    },
  };
}

const timer = (overrides) => parseTimer(apiTimer(overrides));

function renderWidget({ feed = fakeFeed(), config = {}, onView } = {}) {
  const host = document.createElement("helixo-timer");
  document.body.appendChild(host);
  const onVisibleChange = (visible) => {
    host.dataset.state = visible ? "visible" : "empty";
  };
  const result = render(
    <TimerWidget
      config={{ ...CONFIG, ...config }}
      feed={feed}
      clock={clock}
      onVisibleChange={onVisibleChange}
      onView={onView}
    />,
    { container: host },
  );
  return { ...result, host, feed };
}

const digits = (container) =>
  [...container.querySelectorAll(".hx-timer__digits")].map((unit) =>
    [...unit.querySelectorAll(".hx-digit__glyph:not(.hx-digit__glyph--out)")]
      .map((glyph) => glyph.textContent)
      .join(""),
  );

/** Advances time past the next clock tick(s); the clock ticks just after each whole second. */
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms + 10);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  resetVisibility();
});

describe("TimerWidget", () => {
  it("counts down the running timer every second", async () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ endsAt: new Date(NOW + (26 * 3600 + 5 * 60 + 3) * 1000).toISOString() })],
    });
    const { container, host } = renderWidget({ feed });

    expect(host.dataset.state).toBe("visible");
    expect(container.querySelector(".hx-timer__message")).toHaveTextContent("Winter sale ends in");
    expect(digits(container)).toEqual(["01", "02", "05", "03"]);

    await advance(1000);
    expect(digits(container)).toEqual(["01", "02", "05", "02"]);
    // The digit that changed rolls: its old glyph animates out.
    expect(container.querySelector(".hx-digit__glyph--out")).toHaveTextContent("3");
  });

  it("applies the timer's color, size and a readable text color", () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ color: "#ffd966", size: "large" })],
    });
    const { container } = renderWidget({ feed });
    const box = container.querySelector(".hx-timer");
    expect(box).toHaveClass("hx-timer--large");
    expect(box.style.getPropertyValue("--hx-color")).toBe("#ffd966");
    expect(box.style.getPropertyValue("--hx-text")).toBe("#1a1a1a");
  });

  it("uses the default message when the timer has none", () => {
    const feed = fakeFeed({ status: "ready", timers: [timer({ message: "" })] });
    const { container } = renderWidget({ feed });
    expect(container.querySelector(".hx-timer__message")).toHaveTextContent("Sale ends in");
  });

  it("gives screen readers a calm, minute-level description", () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ endsAt: new Date(NOW + 2 * HOUR + 5 * MINUTE + 9_000).toISOString() })],
    });
    const { container } = renderWidget({ feed });
    expect(container.querySelector(".hx-timer__clock")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[role="timer"]')).toHaveTextContent(
      "Winter sale ends in 2 hours, 5 minutes",
    );
  });

  it("plays the urgency effect only during the final hour", async () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ endsAt: new Date(NOW + HOUR + 2_000).toISOString(), urgency: "shake" })],
    });
    const { container } = renderWidget({ feed });
    expect(container.querySelector(".hx-timer")).not.toHaveClass("hx-timer--urgent");

    await advance(2_000);
    expect(container.querySelector(".hx-timer")).toHaveClass("hx-timer--urgent", "hx-timer--shake");
  });

  it("shows that the offer ended when the timer runs out on screen", async () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ endsAt: new Date(NOW + 2_000).toISOString() })],
    });
    const { container, host } = renderWidget({ feed });

    await advance(2_000);

    expect(container.querySelector(".hx-timer")).toHaveClass("hx-timer--ended");
    expect(container.querySelector(".hx-timer__message")).toHaveTextContent("This offer has ended");
    expect(digits(container)).toEqual(["00", "00", "00", "00"]);
    expect(host.dataset.state).toBe("visible");
  });

  it("hands over to the next timer the moment the current one ends", async () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [
        timer({ id: "flash", message: "Flash sale", endsAt: new Date(NOW + 1_000).toISOString() }),
        timer({
          id: "weekend",
          message: "Weekend sale",
          startsAt: new Date(NOW + 1_000).toISOString(),
        }),
      ],
    });
    const { container } = renderWidget({ feed });
    expect(container.querySelector(".hx-timer__message")).toHaveTextContent("Flash sale");

    await advance(1_000);
    expect(container.querySelector(".hx-timer__message")).toHaveTextContent("Weekend sale");
    expect(container.querySelector(".hx-timer--ended")).toBeNull();
  });

  it("counts down an evergreen timer from this shopper's start", async () => {
    // As the feed reports it: resolved to this shopper's start, 10 minutes ago.
    const evergreen = {
      ...parseTimer(apiEvergreenTimer({ durationMinutes: 30, urgency: "none" })),
      startsAt: NOW - 10 * MINUTE,
      endsAt: NOW + 20 * MINUTE,
    };
    const feed = fakeFeed({ status: "ready", timers: [evergreen] });
    const { container } = renderWidget({ feed });

    expect(container.querySelector(".hx-timer__message")).toHaveTextContent(
      "Your welcome offer ends in",
    );
    expect(digits(container)).toEqual(["00", "00", "20", "00"]);
    expect(container.querySelector(".hx-timer__progress-bar").style.transform).toBe(
      `scaleX(${20 / 30})`,
    );

    await advance(20 * MINUTE);
    expect(container.querySelector(".hx-timer")).toHaveClass("hx-timer--ended");
  });

  it("renders nothing, and takes no space, when no timer is running", () => {
    const feed = fakeFeed({
      status: "ready",
      timers: [timer({ startsAt: new Date(NOW + HOUR).toISOString() })],
    });
    const { container, host } = renderWidget({ feed });
    expect(container.querySelector(".hx-timer")).toBeNull();
    expect(host.dataset.state).toBe("empty");
  });

  it("disappears without an 'ended' message when the merchant removes the timer", () => {
    const feed = fakeFeed({ status: "ready", timers: [timer()] });
    const { container, host } = renderWidget({ feed });

    act(() => feed.push({ status: "ready", timers: [] }));

    expect(container.querySelector(".hx-timer")).toBeNull();
    expect(host.dataset.state).toBe("empty");
  });

  it("animates in when a timer appears after the page loaded", () => {
    const feed = fakeFeed({ status: "loading", timers: [] });
    const { container } = renderWidget({ feed });

    act(() => feed.push({ status: "ready", timers: [timer()] }));

    expect(container.querySelector(".hx-root")).toHaveClass("hx-root--enter");
  });

  it("doesn't animate a timer that's there from the start", () => {
    const feed = fakeFeed({ status: "ready", timers: [timer()] });
    const { container } = renderWidget({ feed });
    expect(container.querySelector(".hx-root")).not.toHaveClass("hx-root--enter");
  });

  describe("in the theme editor", () => {
    it("shows a sample and a note when no timer is running", () => {
      const { container, host } = renderWidget({ config: { designMode: true } });
      expect(container.querySelector(".hx-timer")).not.toBeNull();
      expect(container.querySelector(".hx-notice")).toHaveTextContent(
        "No timer is running for this product.",
      );
      expect(host.dataset.state).toBe("visible");
    });

    it("says when timers couldn't be loaded", () => {
      const feed = fakeFeed({ status: "unavailable", timers: [] });
      const { container } = renderWidget({ feed, config: { designMode: true } });
      expect(container.querySelector(".hx-notice")).toHaveTextContent("Timers couldn't be loaded.");
    });

    it("shows the real timer when one is running", () => {
      const feed = fakeFeed({ status: "ready", timers: [timer()] });
      const { container } = renderWidget({ feed, config: { designMode: true } });
      expect(container.querySelector(".hx-notice")).toBeNull();
      expect(container.querySelector(".hx-timer__message")).toHaveTextContent(
        "Winter sale ends in",
      );
    });

    it("shows a sample without a note in the block picker preview", () => {
      const { container } = renderWidget({ feed: null, config: { visualPreview: true } });
      expect(container.querySelector(".hx-timer")).not.toBeNull();
      expect(container.querySelector(".hx-notice")).toBeNull();
    });
  });

  describe("view tracking", () => {
    let screen;
    beforeEach(() => {
      screen = stubIntersectionObserver();
    });

    const show = (ratio) => act(() => screen.setRatio(ratio));

    it("reports a view once the running timer has been half on screen for a second", async () => {
      const onView = vi.fn();
      renderWidget({ feed: fakeFeed({ status: "ready", timers: [timer()] }), onView });

      await show(0.5);
      // `advance` adds 10ms, so this is 990ms on screen.
      await advance(980);
      expect(onView).not.toHaveBeenCalled();

      await advance(0);
      await advance(5_000);
      expect(onView).toHaveBeenCalledExactlyOnceWith("t1");
      expect(screen.observed()).toBe(0);
    });

    it("starts over when the timer leaves the screen too soon", async () => {
      const onView = vi.fn();
      renderWidget({ feed: fakeFeed({ status: "ready", timers: [timer()] }), onView });

      await show(1);
      await advance(600);
      await show(0.4);
      await advance(2_000);
      expect(onView).not.toHaveBeenCalled();

      await show(0.8);
      await advance(1_000);
      expect(onView).toHaveBeenCalledOnce();
    });

    it("waits while the tab is hidden", async () => {
      const onView = vi.fn();
      renderWidget({ feed: fakeFeed({ status: "ready", timers: [timer()] }), onView });

      await show(1);
      await act(() => setVisibility("hidden"));
      await advance(3_000);
      expect(onView).not.toHaveBeenCalled();

      await act(() => setVisibility("visible"));
      await advance(1_000);
      expect(onView).toHaveBeenCalledOnce();
    });

    it("doesn't count a timer that runs out before it's been seen", async () => {
      const onView = vi.fn();
      const feed = fakeFeed({
        status: "ready",
        timers: [timer({ endsAt: new Date(NOW + 3_000).toISOString() })],
      });
      const { container } = renderWidget({ feed, onView });

      // Scrolled into view half a second before it ends. (Renders wait for
      // the end of each `advance`, so the end is its own step.)
      await advance(2_490);
      await show(1);
      await advance(500);
      await advance(3_000);

      // The "offer ended" message stays, but it isn't a view of a running timer.
      expect(container.querySelector(".hx-timer--ended")).not.toBeNull();
      expect(onView).not.toHaveBeenCalled();
    });

    it("counts the next timer when it takes over", async () => {
      const onView = vi.fn();
      const feed = fakeFeed({
        status: "ready",
        timers: [
          timer({ id: "first", endsAt: new Date(NOW + 2_000).toISOString() }),
          timer({ id: "second", endsAt: new Date(NOW + HOUR).toISOString() }),
        ],
      });
      renderWidget({ feed, onView });

      await show(1);
      await advance(3_000);
      await show(1);
      await advance(1_000);

      expect(onView.mock.calls).toEqual([["first"], ["second"]]);
    });

    it("never counts the theme editor's sample", async () => {
      const onView = vi.fn();
      renderWidget({ config: { designMode: true }, onView });

      await show(1);
      await advance(3_000);

      expect(onView).not.toHaveBeenCalled();
    });

    it("tracks nothing without a callback", async () => {
      renderWidget({ feed: fakeFeed({ status: "ready", timers: [timer()] }) });
      expect(screen.observed()).toBe(0);
    });
  });
});
