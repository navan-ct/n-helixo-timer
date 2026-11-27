import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

import { resetClock } from "../src/core/clock.js";
import { resetFeeds } from "../src/core/feed.js";

afterEach(() => {
  cleanup();
  resetClock();
  resetFeeds();
  window.localStorage.clear();
});
