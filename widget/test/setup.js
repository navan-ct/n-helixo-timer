import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/preact";
import { afterEach, vi } from "vitest";

import { resetClock } from "../src/core/clock.js";
import { resetEvergreen } from "../src/core/evergreen.js";
import { resetFeeds } from "../src/core/feed.js";
import { resetImpressions } from "../src/core/impressions.js";

afterEach(() => {
  cleanup();
  resetClock();
  resetFeeds();
  resetEvergreen();
  resetImpressions();
  vi.unstubAllGlobals();
  delete window.Shopify;
  window.localStorage.clear();
});
