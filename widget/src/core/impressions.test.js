import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetVisibility, setVisibility, stubCustomerPrivacy } from "../../test/helpers.js";

import {
  impressionsUrl,
  MAX_IDS_PER_REPORT,
  recordImpression,
  SEND_DELAY_MS,
} from "./impressions.js";

const URL_ = "http://localhost:3000/apps/n-helixo-timer/impressions";

let sendBeacon;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
});

afterEach(() => {
  vi.useRealTimers();
  resetVisibility();
});

/** The timer IDs in each report sent so far. */
const reports = () => sendBeacon.mock.calls.map(([, body]) => JSON.parse(body).timers);

describe("impressionsUrl", () => {
  it("points at the impressions endpoint next to the timers endpoint", () => {
    expect(impressionsUrl("/apps/n-helixo-timer/timers")).toBe(
      `${window.location.origin}/apps/n-helixo-timer/impressions`,
    );
  });
});

describe("recordImpression", () => {
  it("sends the views on the page in one report, a moment later", async () => {
    stubCustomerPrivacy();
    recordImpression(URL_, "t1");
    recordImpression(URL_, "t2");
    expect(sendBeacon).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);

    expect(sendBeacon).toHaveBeenCalledExactlyOnceWith(
      URL_,
      JSON.stringify({ timers: ["t1", "t2"] }),
    );
  });

  it("counts each timer once per page view", async () => {
    stubCustomerPrivacy();
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);

    expect(reports()).toEqual([["t1"]]);
  });

  it("sends right away when the shopper leaves or hides the page", async () => {
    stubCustomerPrivacy();
    recordImpression(URL_, "t1");
    window.dispatchEvent(new Event("pagehide"));
    recordImpression(URL_, "t2");
    setVisibility("hidden");

    expect(reports()).toEqual([["t1"], ["t2"]]);
  });

  it("splits reports to the size the API takes", async () => {
    stubCustomerPrivacy();
    const ids = Array.from({ length: MAX_IDS_PER_REPORT + 2 }, (_, index) => `t${index}`);
    ids.forEach((id) => recordImpression(URL_, id));
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);

    expect(reports()).toEqual([ids.slice(0, MAX_IDS_PER_REPORT), ids.slice(MAX_IDS_PER_REPORT)]);
  });

  it("falls back to a keepalive fetch when beacons aren't available", async () => {
    stubCustomerPrivacy();
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: undefined });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);

    expect(fetch).toHaveBeenCalledWith(
      URL_,
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        body: JSON.stringify({ timers: ["t1"] }),
      }),
    );
  });

  it("never throws, whatever the browser does", async () => {
    stubCustomerPrivacy();
    sendBeacon.mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    recordImpression(URL_, "t1");
    await expect(vi.advanceTimersByTimeAsync(SEND_DELAY_MS)).resolves.not.toThrow();
  });
});

describe("consent", () => {
  it("sends nothing while the visitor hasn't allowed analytics", async () => {
    stubCustomerPrivacy({ allowed: false });
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("sends waiting views once the visitor allows analytics", async () => {
    const privacy = stubCustomerPrivacy({ allowed: false });
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);

    privacy.setAllowed(true);
    document.dispatchEvent(new Event("visitorConsentCollected"));

    expect(reports()).toEqual([["t1"]]);
  });

  it("loads the Customer Privacy API as soon as there's a view, when the theme hasn't", async () => {
    const privacy = stubCustomerPrivacy({ loaded: false });
    recordImpression(URL_, "t1");

    expect(privacy.loadFeatures).toHaveBeenCalledExactlyOnceWith(
      [{ name: "consent-tracking-api", version: "1.0" }],
      expect.any(Function),
    );
    // Loaded within the batch delay: the batch still goes out together.
    recordImpression(URL_, "t2");
    expect(sendBeacon).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(reports()).toEqual([["t1", "t2"]]);
  });

  it("sends views held back while the Customer Privacy API was loading", async () => {
    let finishLoading;
    window.Shopify = {
      loadFeatures: vi.fn((_features, callback) => {
        finishLoading = () => {
          window.Shopify.customerPrivacy = { analyticsProcessingAllowed: () => true };
          callback(null);
        };
      }),
    };
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(sendBeacon).not.toHaveBeenCalled();

    finishLoading();
    expect(reports()).toEqual([["t1"]]);
  });

  it("sends nothing outside a Shopify storefront", async () => {
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("sends nothing if the Customer Privacy API fails to load", async () => {
    window.Shopify = { loadFeatures: vi.fn((_features, callback) => callback(new Error("x"))) };
    recordImpression(URL_, "t1");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
