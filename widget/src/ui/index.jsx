import { render } from "preact";

import { impressionsUrl, recordImpression } from "../core/impressions.js";

import "./styles.css";
import { TimerWidget } from "./TimerWidget.jsx";

/**
 * Entry point of the UI bundle (assets/timer-widget-ui.js). The loader
 * downloads it on demand and calls `mount` for each <helixo-timer> element,
 * passing its own feed and clock so both bundles share one state.
 *
 * @param {HTMLElement} host
 * @param {{
 *   config: object,
 *   feed: ReturnType<typeof import("../core/feed.js").getFeed> | null,
 *   clock: typeof import("../core/clock.js"),
 * }} options
 * @returns {() => void} unmount
 */
export function mount(host, { config, feed, clock }) {
  const root = document.createElement("div");
  host.appendChild(root);
  // The block's stylesheet hides the theme's block wrapper while this is "empty".
  const onVisibleChange = (visible) => {
    host.dataset.state = visible ? "visible" : "empty";
  };
  // Views are counted on the live storefront only, not in the theme editor.
  const tracksViews = Boolean(
    feed && config.endpoint && !config.designMode && !config.visualPreview,
  );
  const url = tracksViews ? impressionsUrl(config.endpoint) : null;
  const onView = url ? (timerId) => recordImpression(url, timerId) : null;
  render(
    <TimerWidget
      config={config}
      feed={feed}
      clock={clock}
      onVisibleChange={onVisibleChange}
      onView={onView}
    />,
    root,
  );
  return () => {
    render(null, root);
    root.remove();
  };
}
