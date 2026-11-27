/**
 * One shared, second-aligned clock for every timer on the page.
 *
 * - It ticks on whole seconds of the corrected time, so every digit on the page
 *   flips together and the countdown never drifts (each tick re-reads the time
 *   instead of counting intervals).
 * - The shopper's device clock can be wrong; `setOffset` applies the difference
 *   measured against the server, so the countdown matches the real end time.
 * - It only runs while something is subscribed, and catches up immediately when
 *   a hidden tab becomes visible again (browsers throttle background timers).
 */

let offsetMs = 0;
const listeners = new Set();
let timeoutId = null;

/** The current time, corrected for the device's clock error. */
export function now() {
  return Date.now() + offsetMs;
}

/** @param {number} offset Server time minus device time, in milliseconds. */
export function setOffset(offset) {
  if (!Number.isFinite(offset)) return;
  offsetMs = offset;
  tick();
}

function schedule() {
  clearTimeout(timeoutId);
  if (listeners.size === 0) {
    timeoutId = null;
    return;
  }
  // A few milliseconds past the boundary, so the tick lands in the new second.
  timeoutId = setTimeout(tick, 1000 - (now() % 1000) + 5);
}

function tick() {
  const current = now();
  for (const listener of listeners) listener(current);
  schedule();
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") tick();
}

/**
 * @param {(now: number) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      schedule();
    }
  };
}

/** Test helper: forget all state. */
export function resetClock() {
  offsetMs = 0;
  listeners.clear();
  clearTimeout(timeoutId);
  timeoutId = null;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}
