/**
 * Builds the storefront bundles into the theme app extension's assets.
 *   node build.js           one-off production build
 *   node build.js --watch   rebuild on change (used by `shopify app dev`)
 */
import { build } from "vite";

import { BUNDLES, bundleConfig } from "./vite.config.js";

const watch = process.argv.includes("--watch");

for (const bundle of Object.keys(BUNDLES)) {
  // Sequential so the output of each bundle stays readable.
  // eslint-disable-next-line no-await-in-loop
  await build(bundleConfig(bundle, { watch }));
}
