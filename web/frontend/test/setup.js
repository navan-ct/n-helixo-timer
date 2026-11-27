import "@testing-library/jest-dom/vitest";

import ShopifyFormat from "@shopify/i18next-shopify";
import { cleanup } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeEach, vi } from "vitest";

import en from "../locales/en.json";

await i18next
  .use(initReactI18next)
  .use(ShopifyFormat)
  .init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

// jsdom doesn't implement layout APIs.
Element.prototype.scrollIntoView = function scrollIntoView() {};

// App Bridge's `shopify` global. jsdom doesn't load the CDN scripts, so Polaris
// `s-*` elements stay un-upgraded and App Bridge APIs are mocked per test.
beforeEach(() => {
  window.shopify = {
    config: { shop: "alpha-store.myshopify.com", apiKey: "test-api-key" },
    toast: { show: vi.fn() },
    loading: vi.fn(),
    resourcePicker: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  delete window.shopify;
});
