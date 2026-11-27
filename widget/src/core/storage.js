/**
 * localStorage that never throws. Storage can be disabled, full, or blocked
 * (private browsing, strict cookie settings, sandboxed iframes); the widget
 * then simply works without a cache.
 */

function backend() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson(key) {
  try {
    const value = backend()?.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    backend()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked: the cache is an optimization only.
  }
}
