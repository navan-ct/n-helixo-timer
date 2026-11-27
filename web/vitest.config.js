import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.js"],
    exclude: ["node_modules/**", "frontend/**"],
    // The first run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
    env: { NODE_ENV: "test" },
    coverage: {
      include: ["api/**", "lib/**", "middleware/**", "shopify/**", "timers/**", "privacy.js"],
    },
  },
});
