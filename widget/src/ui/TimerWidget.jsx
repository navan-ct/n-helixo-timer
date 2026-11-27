import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { runningTimer } from "../core/timer-data.js";

import { Countdown } from "./Countdown.jsx";

/** Stands in when the block can't load timers (no product, or the block picker preview). */
const IDLE_FEED = {
  getState: () => ({ status: "unavailable", timers: [] }),
  subscribe: () => () => {},
};

/** A sample shown in the theme editor when no timer is running for the product. */
function sampleTimer(now, message) {
  // Counts down from 2 days 14:33:12 and restarts every minute, so it always looks alive.
  const remaining = ((2 * 24 + 14) * 3600 + 33 * 60 + 12) * 1000 - (now % 60_000);
  return {
    id: "sample",
    type: "countdown",
    startsAt: now - remaining,
    endsAt: now + remaining,
    message,
    color: "#008060",
    size: "medium",
    urgency: "none",
  };
}

/**
 * What to show, recomputed on every clock tick and feed update. It runs in
 * those callbacks rather than during render because it remembers the timer
 * that was on screen, to tell "ran out while you watched" from "removed".
 *
 * @returns {{ now: number, status: string, running: object | null, ended: object | null }}
 */
function useDisplay(feed, clock) {
  const [display, setDisplay] = useState(() => {
    const { status, timers } = feed.getState();
    const now = clock.now();
    return { now, status, running: runningTimer(timers, now), ended: null };
  });

  useEffect(() => {
    let feedState = feed.getState();
    let shown = null;
    let ended = null;

    const update = () => {
      const now = clock.now();
      const running = runningTimer(feedState.timers, now);
      if (running) {
        shown = running;
        ended = null;
      } else if (shown) {
        if (now >= shown.endsAt) ended = shown;
        shown = null;
      }
      setDisplay({ now, status: feedState.status, running, ended });
    };

    const unsubscribeFeed = feed.subscribe((next) => {
      feedState = next;
      update();
    });
    const unsubscribeClock = clock.subscribe(update);
    return () => {
      unsubscribeFeed();
      unsubscribeClock();
    };
  }, [feed, clock]);

  return display;
}

/**
 * Decides what the block shows:
 * - the highest-priority running timer, counting down;
 * - "offer ended" if the shopper watched the timer run out (and nothing else
 *   took over), so a price change doesn't come out of nowhere;
 * - in the theme editor, a sample with a note when nothing is running, so the
 *   merchant can see and place the block;
 * - otherwise nothing, and the block takes no space.
 *
 * @param {{
 *   config: { locale: string, designMode: boolean, visualPreview: boolean,
 *     strings: Record<string, string> },
 *   feed: ReturnType<typeof import("../core/feed.js").getFeed> | null,
 *   clock: { now: () => number, subscribe: (listener: (now: number) => void) => () => void },
 *   onVisibleChange: (visible: boolean) => void,
 * }} props
 */
export function TimerWidget({ config, feed, clock, onVisibleChange }) {
  const { designMode, visualPreview, strings, locale } = config;
  const { now, status, running, ended } = useDisplay(feed ?? IDLE_FEED, clock);

  let content = null;
  if (running) {
    content = <Countdown timer={running} now={now} strings={strings} locale={locale} />;
  } else if (ended) {
    content = <Countdown timer={ended} now={now} ended strings={strings} locale={locale} />;
  } else if (visualPreview || (designMode && status !== "loading")) {
    content = (
      <>
        <Countdown
          timer={sampleTimer(now, strings.message)}
          now={now}
          strings={strings}
          locale={locale}
        />
        {designMode && !visualPreview && (
          <p class="hx-notice">
            {status === "unavailable" ? strings.editorUnavailable : strings.editorEmpty}
          </p>
        )}
      </>
    );
  }

  // Animate the timer in when it appears after the page has rendered, but not
  // when it's there from the start (cached data renders immediately).
  const visible = content !== null;
  const wasVisibleRef = useRef(visible);
  const [entering, setEntering] = useState(false);
  useLayoutEffect(() => {
    if (visible && !wasVisibleRef.current) setEntering(true);
    wasVisibleRef.current = visible;
    onVisibleChange(visible);
  }, [visible, onVisibleChange]);

  if (!content) return null;
  return (
    <div
      class={`hx-root${entering ? " hx-root--enter" : ""}`}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntering(false);
      }}
    >
      {content}
    </div>
  );
}
