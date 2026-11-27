import { render } from "preact";

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
  render(
    <TimerWidget config={config} feed={feed} clock={clock} onVisibleChange={onVisibleChange} />,
    root,
  );
  return () => {
    render(null, root);
    root.remove();
  };
}
