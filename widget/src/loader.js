import * as clock from "./core/clock.js";
import { getFeed } from "./core/feed.js";

/**
 * Entry point of the storefront widget (assets/timer-widget.js), loaded on
 * every page with the app block. It's deliberately small and framework-free:
 * it defines the <helixo-timer> element, loads and keeps the product's timers
 * up to date (core/feed.js), and only then downloads the Preact UI
 * (assets/timer-widget-ui.js) if there's a timer to show. Product pages without
 * a timer never pay for rendering code.
 *
 * A custom element is used so each block mounts and cleans up by itself when
 * the theme editor re-renders sections, or when themes inject product markup
 * later (quick view, section rendering).
 */

const TAG = "helixo-timer";
const NUMERIC_ID = /^\d+$/;
const UI_GLOBAL = "HelixoTimerUI";

let uiPromise = null;

/** Loads the UI bundle once per page, however many blocks need it at the same time. */
function loadUI(src) {
  if (window[UI_GLOBAL]) return Promise.resolve(window[UI_GLOBAL]);
  uiPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      // From now on the global itself answers (see the check above).
      uiPromise = null;
      if (window[UI_GLOBAL]) resolve(window[UI_GLOBAL]);
      else reject(new Error("UI bundle is empty"));
    };
    script.onerror = () => {
      // Let a later block (or a later poll) try again.
      uiPromise = null;
      script.remove();
      reject(new Error(`Couldn't load ${src}`));
    };
    document.head.appendChild(script);
  });
  return uiPromise;
}

function readConfig(element) {
  const { dataset } = element;
  let strings = {};
  try {
    strings = JSON.parse(element.querySelector("script[data-strings]")?.textContent || "{}");
  } catch {
    // Fall back to the built-in English strings below.
  }

  return {
    endpoint: dataset.endpoint ?? "",
    uiSrc: dataset.uiSrc ?? "",
    shop: dataset.shop || window.location.host,
    productId: NUMERIC_ID.test(dataset.productId ?? "") ? dataset.productId : "",
    collectionIds: (dataset.collectionIds ?? "").split(",").filter((id) => NUMERIC_ID.test(id)),
    locale: dataset.locale || document.documentElement.lang || "en",
    designMode: dataset.designMode === "true",
    visualPreview: dataset.visualPreview === "true",
    strings: {
      message: "Sale ends in",
      ended: "This offer has ended",
      days: "Days",
      hours: "Hrs",
      minutes: "Min",
      seconds: "Sec",
      editorEmpty: "Preview: no timer is running for this product.",
      editorUnavailable: "Preview: timers couldn’t be loaded.",
      ...strings,
    },
  };
}

const reportError = (error) => {
  // eslint-disable-next-line no-console -- surfaced for theme developers; the page carries on
  console.error("[helixo-timer]", error);
};

class HelixoTimerElement extends HTMLElement {
  connectedCallback() {
    if (this.connected) return;
    this.connected = true;
    // Hidden (with the theme's block spacing) until there's something to show.
    this.dataset.state = "empty";

    try {
      const config = readConfig(this);
      const feed =
        config.endpoint && config.productId && !config.visualPreview
          ? getFeed({
              endpoint: config.endpoint,
              shop: config.shop,
              productId: config.productId,
              collectionIds: config.collectionIds,
              // The theme editor always shows fresh data.
              useCache: !config.designMode,
            })
          : null;

      // The theme editor always renders the UI (a sample when nothing runs).
      const alwaysShow = config.designMode || config.visualPreview;
      const hasTimerToShow = ({ timers }) => {
        const now = clock.now();
        return timers.some((timer) => timer.endsAt > now);
      };

      const mount = () => {
        if (this.mounting) return;
        this.mounting = true;
        loadUI(config.uiSrc)
          .then((ui) => {
            if (this.connected && !this.unmount) {
              this.unmount = ui.mount(this, { config, feed, clock });
            }
          })
          .catch((error) => {
            this.mounting = false;
            reportError(error);
          });
      };

      if (alwaysShow) mount();
      if (feed) {
        // Stays subscribed for the element's lifetime, so the feed keeps running
        // (and polling) while the UI loads and while there's nothing to show.
        this.unsubscribe = feed.subscribe((state) => {
          if (hasTimerToShow(state)) mount();
        });
      }
    } catch (error) {
      reportError(error);
    }
  }

  disconnectedCallback() {
    this.connected = false;
    this.mounting = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unmount?.();
    this.unmount = null;
  }
}

if (!window.customElements.get(TAG)) {
  window.customElements.define(TAG, HelixoTimerElement);
}
