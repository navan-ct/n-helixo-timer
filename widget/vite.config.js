import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const OUT_DIR = fileURLToPath(new URL("../extensions/timer-widget/assets", import.meta.url));
const source = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The two bundles the theme app extension serves from its assets folder:
 *
 * - `loader` (timer-widget.js): referenced by the app block's schema, so it
 *   loads on every page with the block. Small and framework-free; it fetches
 *   and caches timers. Theme Check caps this file at 10 KB.
 * - `ui` (timer-widget-ui.js + timer-widget.css): Preact and the countdown,
 *   downloaded by the loader only when there's a timer to show. The stylesheet
 *   is referenced by the schema too, because it also hides empty blocks.
 */
export const BUNDLES = {
  loader: { entry: source("./src/loader.js"), name: "HelixoTimer", fileName: "timer-widget.js" },
  ui: {
    entry: source("./src/ui/index.jsx"),
    name: "HelixoTimerUI",
    fileName: "timer-widget-ui.js",
    cssFileName: "timer-widget",
  },
};

/** Vite build config for one bundle. Used by build.js. */
export function bundleConfig(bundle, { watch = false } = {}) {
  const { entry, name, fileName, cssFileName } = BUNDLES[bundle];
  return {
    configFile: false,
    mode: "production",
    logLevel: "info",
    // jsxDev stays off even when `shopify app dev` sets NODE_ENV=development,
    // so the dev bundle matches what ships.
    esbuild: { jsx: "automatic", jsxImportSource: "preact", jsxDev: false },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: OUT_DIR,
      // The folder belongs to the extension and holds the other bundle too.
      emptyOutDir: false,
      // Storefront themes target evergreen browsers.
      target: "es2020",
      watch: watch ? {} : null,
      lib: {
        entry,
        // Classic scripts: theme app extension assets load with a plain <script>.
        formats: ["iife"],
        name,
        fileName: () => fileName,
        ...(cssFileName && { cssFileName }),
      },
    },
  };
}

// Test configuration (Vitest reads this file directly).
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    include: ["src/**/*.test.{js,jsx}", "test/**/*.test.{js,jsx}"],
    css: false,
    restoreMocks: true,
  },
});
