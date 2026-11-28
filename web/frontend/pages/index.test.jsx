import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockFetch, renderWithProviders } from "../test/render";

import HomePage, { addAppBlockUrl, themeEditorUrl } from "./index";

function analytics(overrides = {}) {
  return {
    impressions: { days: 30, current: 26589, previous: 23710 },
    timers: { running: 2, scheduled: 1, evergreen: 3 },
    ...overrides,
  };
}

/** What `shopify.app.extensions()` reports for the Timer block on the published theme. */
function themeExtensions(status) {
  return [
    {
      handle: "timer-widget",
      type: "theme_app_extension",
      activations: [
        {
          handle: "timer",
          name: "Timer",
          target: "section",
          status,
          activations:
            status === "active"
              ? [
                  {
                    target: "template--product/main/timer_x",
                    themeId: "gid://shopify/OnlineStoreTheme/1",
                  },
                ]
              : [],
        },
      ],
    },
  ];
}

function renderHome({ body = analytics(), block = "available" } = {}) {
  window.shopify.app.extensions.mockResolvedValue(themeExtensions(block));
  const fetchMock = mockFetch((url) =>
    url === "/api/analytics" ? [200, body] : [404, { error: { message: "Not found" } }],
  );
  return { fetchMock, ...renderWithProviders(<HomePage />) };
}

/** The analytics card labeled `label`: its number, badge and note. */
function card(label) {
  const section = screen.getByText(label).closest("s-section");
  return {
    section,
    value: section.querySelector("s-heading")?.textContent,
    badge: section.querySelector("s-badge"),
    footnote: [...section.querySelectorAll("s-text")].at(-1).textContent,
  };
}

describe("HomePage layout", () => {
  it("puts the analytics first, then the Timer Block section", async () => {
    const { container } = renderHome();
    await screen.findByText("26,589");

    const analyticsHeading = screen.getByText("Analytics");
    expect(analyticsHeading.tagName).toBe("S-HEADING");
    expect(analyticsHeading).toHaveAttribute("fontSize", "large");

    const sections = [...container.querySelectorAll("s-section")];
    expect(sections).toHaveLength(4);
    // Each metric is its own card, right under the Analytics heading.
    const cards = sections.slice(0, 3);
    expect(cards.map((section) => section.getAttribute("accessibilityLabel"))).toEqual([
      "Impressions",
      "Active timers",
      "Scheduled timers",
    ]);
    for (const card of cards) expect(card.parentElement.closest("s-section")).toBeNull();
    expect(analyticsHeading.nextElementSibling).toContainElement(cards[0]);

    expect(sections[3]).toHaveAttribute("heading", "Timer Block");
    expect(sections[3]).toHaveTextContent("Show timers on your product pages");
  });

  it("encodes the block ID in the deep link", () => {
    expect(addAppBlockUrl({ shop: "a.myshopify.com", apiKey: "key" })).toBe(
      "https://a.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=key%2Ftimer&target=mainSection",
    );
    expect(themeEditorUrl({ shop: "a.myshopify.com" })).toBe(
      "https://a.myshopify.com/admin/themes/current/editor?template=product",
    );
  });
});

describe("HomePage Timer Block section", () => {
  const NOT_ADDED = {
    body: "Add the Timer block to your product page in the theme editor. It shows the timer that applies to each product.",
    firstStep: "Click Add to product page, then click Save in the theme editor.",
    button: "Add to product page",
    params: { template: "product", addAppBlockId: "test-api-key/timer", target: "mainSection" },
  };
  const ADDED = {
    body: "The Timer block is on your product page in your live theme. It shows the timer that applies to each product.",
    firstStep: "Click Open theme editor to change the block’s alignment or spacing.",
    button: "Open theme editor",
    params: { template: "product" },
  };

  /**
   * The Timer Block section shows `copy`, in the same layout either way: a heading,
   * a paragraph, three steps and three buttons, and no status badge.
   */
  function expectTimerBlockSection(container, copy) {
    const widget = container.querySelector('s-section[heading="Timer Block"]');
    expect(widget.querySelectorAll("s-heading")).toHaveLength(1);
    expect(widget.querySelector("s-heading")).toHaveTextContent(
      "Show timers on your product pages",
    );
    expect(widget.querySelectorAll("s-paragraph")).toHaveLength(1);
    expect(widget.querySelector("s-paragraph")).toHaveTextContent(copy.body);
    expect([...widget.querySelectorAll("s-list-item")].map((item) => item.textContent)).toEqual([
      copy.firstStep,
      "Move the block to where you want it on the page.",
      "Create a countdown or evergreen timer.",
    ]);
    expect(widget.querySelector("s-badge")).toBeNull();

    const buttons = [...widget.querySelectorAll("s-button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      copy.button,
      "Create countdown timer",
      "Create evergreen timer",
    ]);
    const [editorButton, countdownButton, evergreenButton] = buttons;
    expect(editorButton).toHaveAttribute("variant", "primary");
    expect(editorButton).toHaveAttribute("icon", "external");
    expect(editorButton).toHaveAttribute("target", "_blank");
    const url = new URL(editorButton.getAttribute("href"));
    expect(url.origin).toBe("https://alpha-store.myshopify.com");
    expect(url.pathname).toBe("/admin/themes/current/editor");
    expect(Object.fromEntries(url.searchParams)).toEqual(copy.params);
    expect(countdownButton).toHaveAttribute("href", "/countdown-timers");
    expect(evergreenButton).toHaveAttribute("href", "/evergreen-timers");
  }

  it("explains how to add the block when it isn't on the theme", async () => {
    const { container } = renderHome({ block: "available" });
    expect(await screen.findByText("26,589")).toBeInTheDocument();
    expectTimerBlockSection(container, NOT_ADDED);
  });

  it("says the block is on the theme once it's added, and doesn't add another", async () => {
    const { container } = renderHome({ block: "active" });
    expect(await screen.findByText("Open theme editor")).toBeInTheDocument();
    expectTimerBlockSection(container, ADDED);
  });

  it("uses the add wording for a theme without app blocks", async () => {
    const { container } = renderHome({ block: "unavailable" });
    expect(await screen.findByText("26,589")).toBeInTheDocument();
    expectTimerBlockSection(container, NOT_ADDED);
  });

  it("uses the add wording while it checks the theme, or if it can't", async () => {
    window.shopify.app.extensions.mockReturnValue(new Promise(() => {}));
    mockFetch(() => [200, analytics()]);
    const pending = renderWithProviders(<HomePage />);
    expectTimerBlockSection(pending.container, NOT_ADDED);
    pending.unmount();

    window.shopify.app.extensions.mockRejectedValue(new Error("App Bridge unavailable"));
    const failed = renderWithProviders(<HomePage />);
    expect(await screen.findByText("26,589")).toBeInTheDocument();
    expectTimerBlockSection(failed.container, NOT_ADDED);
  });

  it("checks again when the merchant comes back to the app", async () => {
    const { container } = renderHome({ block: "available" });
    await screen.findByText("Add to product page");

    window.shopify.app.extensions.mockResolvedValue(themeExtensions("active"));
    // React Query refetches when the page regains focus.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByText("Open theme editor")).toBeInTheDocument();
    expectTimerBlockSection(container, ADDED);
  });
});

describe("HomePage analytics", () => {
  it("shows impressions for the last 30 days and how they changed", async () => {
    const { fetchMock } = renderHome();
    await screen.findByText("26,589");

    const impressions = card("Impressions");
    expect(impressions.value).toBe("26,589");
    expect(impressions.footnote).toBe("Last 30 days");
    expect(impressions.badge).toHaveAttribute("tone", "success");
    expect(impressions.badge).toHaveAttribute("icon", "arrow-up");
    expect(impressions.badge).toHaveTextContent("12%");
    expect(screen.getByText("Up 12% from the previous 30 days")).toHaveAttribute(
      "accessibilityVisibility",
      "exclusive",
    );
    // The number is large type, not a heading in the page outline.
    expect(impressions.section.querySelector("s-heading")).toHaveAttribute(
      "accessibilityRole",
      "presentation",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics", expect.anything());
  });

  it("marks a drop in impressions, and no change", async () => {
    const { unmount } = renderHome({
      body: analytics({ impressions: { days: 30, current: 958, previous: 4210 } }),
    });
    await screen.findByText("958");
    const drop = card("Impressions").badge;
    expect(drop).toHaveAttribute("tone", "critical");
    expect(drop).toHaveAttribute("icon", "arrow-down");
    expect(drop).toHaveTextContent("77%");
    unmount();

    renderHome({ body: analytics({ impressions: { days: 30, current: 100, previous: 100 } }) });
    await screen.findByText("100");
    const same = card("Impressions").badge;
    expect(same).toHaveAttribute("tone", "neutral");
    expect(same).toHaveTextContent("0%");
    expect(screen.getByText("No change from the previous 30 days")).toBeInTheDocument();
  });

  it("leaves out the change when there's nothing to compare with", async () => {
    renderHome({ body: analytics({ impressions: { days: 30, current: 40, previous: 0 } }) });
    await screen.findByText("40");
    expect(card("Impressions").badge).toBeNull();
  });

  it("counts running timers and scheduled countdowns", async () => {
    renderHome();
    await screen.findByText("26,589");

    expect(card("Active timers")).toMatchObject({
      value: "5",
      footnote: "2 countdown, 3 evergreen",
    });
    expect(card("Scheduled timers")).toMatchObject({
      value: "1",
      footnote: "Countdowns that start later",
    });
  });

  it("says when no timer is running", async () => {
    renderHome({ body: analytics({ timers: { running: 0, scheduled: 0, evergreen: 0 } }) });
    await screen.findByText("26,589");
    expect(card("Active timers")).toMatchObject({
      value: "0",
      footnote: "No timers are running",
    });
  });

  it("keeps the cards in place with spinners while analytics load", async () => {
    let respond;
    window.shopify.app.extensions.mockResolvedValue(themeExtensions("active"));
    mockFetch(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    renderWithProviders(<HomePage />);

    for (const label of ["Impressions", "Active timers", "Scheduled timers"]) {
      expect(card(label).section.querySelector("s-spinner")).toHaveAttribute(
        "accessibilityLabel",
        "Loading",
      );
    }

    await act(async () => respond([200, analytics()]));
    expect(await screen.findByText("26,589")).toBeInTheDocument();
  });

  it("shows an error with a retry when analytics can't load", async () => {
    let fail = true;
    mockFetch(() =>
      fail ? [500, { error: { message: "Something went wrong." } }] : [200, analytics()],
    );
    const { container } = renderWithProviders(<HomePage />);

    const banner = await waitFor(() => {
      const element = container.querySelector('s-banner[tone="critical"]');
      expect(element).not.toBeNull();
      return element;
    });
    expect(banner).toHaveAttribute("heading", "Couldn’t load analytics");
    // The setup section still works.
    expect(screen.getByText("Show timers on your product pages")).toBeInTheDocument();

    fail = false;
    await act(async () => screen.getByText("Try again").click());
    expect(await screen.findByText("26,589")).toBeInTheDocument();
  });
});
