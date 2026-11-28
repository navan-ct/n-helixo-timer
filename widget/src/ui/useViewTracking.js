import { useEffect, useRef } from "preact/hooks";

/** At least this much of the timer must be on screen... */
export const VIEWABLE_RATIO = 0.5;
/** ...for this long, in a visible tab, to count as a view (IAB/MRC viewability). */
export const VIEWABLE_MS = 1_000;

/**
 * Calls `onView(timerId)` once the element has been at least half on screen
 * for a second while the tab is visible. Scrolling away or hiding the tab
 * before then starts the second over. A new `timerId` (another timer took
 * the block) is tracked afresh.
 *
 * @param {{ current: Element | null }} ref
 * @param {string | null} timerId Nothing is tracked while it's null.
 * @param {((timerId: string) => void) | null | undefined} onView
 */
export function useViewTracking(ref, timerId, onView) {
  // The latest callback, without restarting the second when it changes.
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  });
  const enabled = Boolean(onView);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !timerId || !element) return undefined;

    let inView = false;
    let timeout = null;
    let observer = null;

    const cancel = () => {
      clearTimeout(timeout);
      timeout = null;
    };
    const stop = () => {
      cancel();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
    function update() {
      if (!inView || document.visibilityState === "hidden") {
        cancel();
        return;
      }
      timeout ??= setTimeout(() => {
        stop();
        onViewRef.current?.(timerId);
      }, VIEWABLE_MS);
    }

    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          inView = entry.isIntersecting && entry.intersectionRatio >= VIEWABLE_RATIO;
          update();
        },
        { threshold: [0, VIEWABLE_RATIO] },
      );
      observer.observe(element);
    } else {
      // Browsers without IntersectionObserver: being rendered in a visible tab is the best signal.
      inView = true;
      update();
    }
    document.addEventListener("visibilitychange", update);
    return stop;
  }, [ref, timerId, enabled]);
}
