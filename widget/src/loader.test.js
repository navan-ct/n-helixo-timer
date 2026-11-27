import { waitFor } from "@testing-library/preact";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse, apiTimer, fakeFetch, HOUR, NOW } from "../test/helpers.js";

const UI_SRC = "https://cdn.shopify.com/extensions/abc/assets/timer-widget-ui.js";

/** Stands in for the UI bundle, which defines window.HelixoTimerUI when it loads. */
const ui = { mount: vi.fn(() => vi.fn()) };

function addBlock({ productId = "1001", designMode = false, strings } = {}) {
  const element = document.createElement("helixo-timer");
  Object.assign(element.dataset, {
    endpoint: "/apps/n-helixo-timer/timers",
    uiSrc: UI_SRC,
    shop: "alpha-store.myshopify.com",
    productId,
    collectionIds: "2001,abc",
    locale: "fr",
    designMode: String(designMode),
    visualPreview: "false",
  });
  if (strings) {
    element.innerHTML = `<script type="application/json" data-strings>${JSON.stringify(strings)}</script>`;
  }
  document.body.appendChild(element);
  return element;
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

beforeAll(async () => {
  await import("./loader.js");
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  ui.mount.mockClear();
  delete window.HelixoTimerUI;
  // Simulate the UI bundle executing once the loader adds its script tag.
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node.tagName === "SCRIPT") {
      queueMicrotask(() => {
        window.HelixoTimerUI = ui;
        node.onload?.();
      });
    }
    return node;
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("<helixo-timer>", () => {
  it("stays hidden and never loads the UI when no timer applies", async () => {
    const fetch = fakeFetch(() => apiResponse([]));
    vi.stubGlobal("fetch", fetch);
    const element = addBlock();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settle();

    expect(element.dataset.state).toBe("empty");
    expect(document.head.appendChild).not.toHaveBeenCalled();
    expect(ui.mount).not.toHaveBeenCalled();
  });

  it("loads the UI and mounts it with its config once there's a timer", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => apiResponse([apiTimer()])),
    );
    const element = addBlock({ strings: { message: "Fin de l’offre dans" } });

    await waitFor(() => expect(ui.mount).toHaveBeenCalledTimes(1));
    const [host, { config, feed, clock }] = ui.mount.mock.calls[0];
    expect(host).toBe(element);
    expect(config).toMatchObject({
      productId: "1001",
      collectionIds: ["2001"],
      locale: "fr",
      designMode: false,
      strings: { message: "Fin de l’offre dans", ended: "This offer has ended" },
    });
    expect(feed.getState().timers).toHaveLength(1);
    expect(typeof clock.now).toBe("function");
  });

  it("doesn't load the UI for timers that have already ended", async () => {
    const fetch = fakeFetch(() =>
      apiResponse([
        apiTimer({
          endsAt: new Date(NOW - HOUR).toISOString(),
          startsAt: new Date(NOW - 2 * HOUR).toISOString(),
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    addBlock();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settle();
    expect(ui.mount).not.toHaveBeenCalled();
  });

  it("downloads the UI once for several blocks", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => apiResponse([apiTimer()])),
    );
    addBlock();
    addBlock({ productId: "1002" });

    await waitFor(() => expect(ui.mount).toHaveBeenCalledTimes(2));
    expect(document.head.appendChild).toHaveBeenCalledTimes(1);
  });

  it("always shows in the theme editor", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => apiResponse([])),
    );
    addBlock({ designMode: true });
    await waitFor(() => expect(ui.mount).toHaveBeenCalledTimes(1));
  });

  it("does nothing without a product", async () => {
    const fetch = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    const element = addBlock({ productId: "" });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(element.dataset.state).toBe("empty");
  });

  it("unmounts when the block is removed", async () => {
    const unmount = vi.fn();
    ui.mount.mockReturnValueOnce(unmount);
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => apiResponse([apiTimer()])),
    );
    const element = addBlock();
    await waitFor(() => expect(ui.mount).toHaveBeenCalled());

    element.remove();
    expect(unmount).toHaveBeenCalled();
  });
});
