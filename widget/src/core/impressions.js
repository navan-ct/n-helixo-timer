/**
 * Reports timer impressions to the storefront API, for the merchant's
 * analytics. A view counts when at least half of a running timer is on screen
 * for a whole second (the IAB/MRC viewability standard; the UI decides that,
 * see ui/useViewTracking.js), and each timer counts at most once per page view.
 *
 * - Anonymous: a report carries timer IDs and nothing else. No cookie, storage
 *   or identifier is used, and the server only keeps daily counts.
 * - Consent: reports are sent only when Shopify's Customer Privacy API says
 *   analytics processing is allowed for this visitor. Views wait (for the rest
 *   of the page view) if consent is given later, and are dropped otherwise.
 * - Cheap: views are batched for a moment, so several blocks on one page send
 *   one request, and sent with `navigator.sendBeacon`, which survives the
 *   shopper leaving the page and never delays it.
 *
 * The theme editor never reports views (the caller doesn't track them there).
 */

/** Views are batched this long before they're sent. Leaving the page sends them right away. */
export const SEND_DELAY_MS = 2_000;
/** The most timer IDs the API takes per report. Keep in step with the server. */
export const MAX_IDS_PER_REPORT = 10;

/** Timer IDs counted on this page, so a timer counts once however often it's shown. */
const counted = new Set();
/** Report URL -> timer IDs waiting to be sent. */
const pending = new Map();
let sendTimeout = null;
let listening = false;
let loadingPrivacyApi = false;

/** The impressions endpoint that sits next to the widget's timers endpoint. */
export function impressionsUrl(timersEndpoint) {
  const timersUrl = new URL(timersEndpoint, window.location.origin);
  return new URL("impressions", timersUrl).toString();
}

const privacyApiLoaded = () =>
  typeof window.Shopify?.customerPrivacy?.analyticsProcessingAllowed === "function";

/**
 * Loads the Customer Privacy API if the theme hasn't, as soon as there's a view
 * to report, so it's ready by the time views are sent.
 * https://shopify.dev/docs/api/customer-privacy#loading-the-customer-privacy-api
 */
function loadPrivacyApi() {
  const shopify = window.Shopify;
  if (privacyApiLoaded() || loadingPrivacyApi || typeof shopify?.loadFeatures !== "function") {
    return;
  }
  loadingPrivacyApi = true;
  try {
    shopify.loadFeatures([{ name: "consent-tracking-api", version: "1.0" }], (error) => {
      // Send what was held back while it loaded; a batch still waiting sends itself.
      if (!error && sendTimeout === null) send();
    });
  } catch {
    // Without the API, views are never sent: the page carries on as usual.
  }
}

/** Whether this visitor's analytics may be collected right now. */
function analyticsAllowed() {
  const privacy = window.Shopify?.customerPrivacy;
  if (!privacyApiLoaded()) {
    loadPrivacyApi();
    return false;
  }
  try {
    return privacy.analyticsProcessingAllowed() === true;
  } catch {
    return false;
  }
}

function post(url, timerIds) {
  const body = JSON.stringify({ timers: timerIds });
  try {
    // A string body goes as text/plain, which the API accepts.
    if (navigator.sendBeacon?.(url, body)) return;
  } catch {
    // Fall through to fetch.
  }
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Analytics never break the page.
  }
}

/** Sends waiting views, if the visitor allows analytics; otherwise they keep waiting. */
function send() {
  clearTimeout(sendTimeout);
  sendTimeout = null;
  if (pending.size === 0 || !analyticsAllowed()) return;

  for (const [url, ids] of pending) {
    const list = [...ids];
    for (let start = 0; start < list.length; start += MAX_IDS_PER_REPORT) {
      post(url, list.slice(start, start + MAX_IDS_PER_REPORT));
    }
  }
  pending.clear();
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") send();
}

function listen() {
  if (listening) return;
  listening = true;
  // Leaving or hiding the page sends what's waiting, before the batch delay is up.
  window.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", onVisibilityChange);
  // Fired by the Customer Privacy API when the visitor answers the consent banner.
  document.addEventListener("visitorConsentCollected", send);
}

/**
 * Counts one view of a timer, once per page view.
 * @param {string} url The impressions endpoint (see `impressionsUrl`)
 * @param {string} timerId
 */
export function recordImpression(url, timerId) {
  if (!url || !timerId || counted.has(timerId)) return;
  counted.add(timerId);

  if (!pending.has(url)) pending.set(url, new Set());
  pending.get(url).add(timerId);

  listen();
  sendTimeout ??= setTimeout(send, SEND_DELAY_MS);
  loadPrivacyApi();
}

/** Test helper: forget all state. */
export function resetImpressions() {
  counted.clear();
  pending.clear();
  clearTimeout(sendTimeout);
  sendTimeout = null;
  loadingPrivacyApi = false;
  if (listening) {
    window.removeEventListener("pagehide", send);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("visitorConsentCollected", send);
    listening = false;
  }
}
