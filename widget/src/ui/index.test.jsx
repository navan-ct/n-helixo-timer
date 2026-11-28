import { act } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiTimer,
  NOW,
  stubCustomerPrivacy,
  stubIntersectionObserver,
} from "../../test/helpers.js";
import * as clock from "../core/clock.js";
import { SEND_DELAY_MS } from "../core/impressions.js";
import { parseTimer } from "../core/timer-data.js";

import { mount } from "./index.jsx";

const STRINGS = {
  message: "Sale ends in",
  ended: "Ended",
  days: "D",
  hours: "H",
  minutes: "M",
  seconds: "S",
};

function staticFeed(timers) {
  const state = { status: "ready", timers };
  return { getState: () => state, subscribe: (listener) => (listener(state), () => {}) };
}

let sendBeacon;
let screen;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
  screen = stubIntersectionObserver();
  stubCustomerPrivacy();
});

afterEach(() => {
  vi.useRealTimers();
});

function mountBlock(config) {
  const host = document.createElement("helixo-timer");
  document.body.appendChild(host);
  const unmount = mount(host, {
    config: { endpoint: "/apps/n-helixo-timer/timers", strings: STRINGS, ...config },
    feed: staticFeed([parseTimer(apiTimer())]),
    clock,
  });
  return { host, unmount };
}

async function viewForASecond() {
  // Let Preact run the block's effects, which start watching it.
  await act(() => vi.advanceTimersByTimeAsync(200));
  await act(() => screen.setRatio(1));
  await act(() => vi.advanceTimersByTimeAsync(1_000 + SEND_DELAY_MS));
}

describe("mount", () => {
  it("reports views of the storefront's timers to the impressions endpoint", async () => {
    const { unmount } = mountBlock({ designMode: false, visualPreview: false });
    await viewForASecond();

    expect(sendBeacon).toHaveBeenCalledWith(
      `${window.location.origin}/apps/n-helixo-timer/impressions`,
      JSON.stringify({ timers: ["t1"] }),
    );
    unmount();
  });

  it("doesn't report views in the theme editor", async () => {
    const { unmount } = mountBlock({ designMode: true, visualPreview: false });
    await viewForASecond();

    expect(screen.observed()).toBe(0);
    expect(sendBeacon).not.toHaveBeenCalled();
    unmount();
  });
});
