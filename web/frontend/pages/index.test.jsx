import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";

import HomePage, { addAppBlockUrl } from "./index";

describe("HomePage", () => {
  it("links to the theme editor to add the timer block to the product page", () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByText("Show timers on your product pages")).toBeInTheDocument();
    const addButton = screen.getByText("Add to product page");
    expect(addButton).toHaveAttribute("target", "_blank");

    const url = new URL(addButton.getAttribute("href"));
    expect(url.origin).toBe("https://alpha-store.myshopify.com");
    expect(url.pathname).toBe("/admin/themes/current/editor");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "product",
      addAppBlockId: "test-api-key/timer",
      target: "mainSection",
    });
  });

  it("links to the countdown timers page", () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText("Create countdown timer")).toHaveAttribute("href", "/countdown-timers");
  });

  it("encodes the block ID in the deep link", () => {
    expect(addAppBlockUrl({ shop: "a.myshopify.com", apiKey: "key" })).toBe(
      "https://a.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=key%2Ftimer&target=mainSection",
    );
  });
});
