import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { splitDuration } from "../../utils/time";
import { HEX_COLOR, readableTextColor } from "../../utils/timerForm";

import "./TimerPreview.css";

/** The sample shown before an end date is set: 2 days, 14:33:12, restarting every minute. */
const SAMPLE_DURATION_MS = ((2 * 24 + 14) * 3600 + 33 * 60 + 12) * 1000;

/** The current time, updated just after each whole second, like the storefront widget. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timeoutId;
    const tick = () => {
      setNow(Date.now());
      timeoutId = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    timeoutId = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => clearTimeout(timeoutId);
  }, []);
  return now;
}

/**
 * When the evergreen preview started: the preview's current time when it first
 * shows a duration, and again whenever the duration changes, so it always plays
 * from the full duration like a shopper arriving now. Using the preview's own
 * clock keeps the first frame at exactly the duration.
 */
function useEvergreenStart(duration, now) {
  const [start, setStart] = useState(() => ({ duration, at: now }));
  if (start.duration !== duration) {
    setStart({ duration, at: now });
    return now;
  }
  return start.at;
}

/** Two-digit (or longer) text for a unit, as digits from the right: ones place first. */
const digitsFromRight = (value) => String(value).padStart(2, "0").split("").reverse();

/**
 * The digits of a unit, left to right, each with its place value (0 = ones) and
 * the digit shown in that place a second earlier (null to skip the animation).
 */
function placedDigits(value, previousValue) {
  const previous = previousValue == null ? [] : digitsFromRight(previousValue);
  return digitsFromRight(value)
    .map((digit, place) => ({ place, digit, previous: previous[place] ?? null }))
    .reverse();
}

/**
 * One digit that rolls to its new value, as on the storefront: the previous
 * glyph slides out while the new one slides in. Keyed by value, so a new value
 * mounts a new element and its CSS animation plays.
 */
function Digit({ value, previous }) {
  const rolling = previous != null && previous !== value;
  return (
    <span className="timer-preview__digit">
      {rolling && (
        <span
          key={`out-${previous}-${value}`}
          className="timer-preview__glyph timer-preview__glyph--out"
        >
          {previous}
        </span>
      )}
      <span
        key={value}
        className={`timer-preview__glyph${rolling ? " timer-preview__glyph--in" : ""}`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Live preview of the storefront timer on a product page. It's app-owned
 * markup (not a Polaris component) because it mimics the storefront rather
 * than the admin, and it's a hand-made copy of the widget's look
 * (widget/src/ui/Countdown.jsx and styles.css): the same layout, digit tiles,
 * rolling digits and progress line, at preview scale. The urgency effect loops
 * so merchants can see it; the storefront plays it during the final hour.
 *
 * @param {{
 *   color: string,
 *   size: string,
 *   urgency: string,
 *   description?: string,
 *   startsAt?: number | null,
 *   endsAt?: number | null,
 *   duration?: number | null,
 * }} props Times are UTC timestamps. Without `endsAt` the preview shows a
 *   sample countdown; without `startsAt` the timer starts now. `duration` (in
 *   milliseconds) previews an evergreen timer instead: it runs from the moment
 *   it's shown, as for a shopper arriving now.
 */
export function TimerPreview({
  color,
  size,
  urgency,
  description,
  startsAt: scheduledStart,
  endsAt: scheduledEnd,
  duration,
}) {
  const { t } = useTranslation();
  const now = useNow();
  const evergreenStart = useEvergreenStart(duration, now);
  const startsAt = duration ? evergreenStart : scheduledStart;
  const endsAt = duration ? evergreenStart + duration : scheduledEnd;

  const background = HEX_COLOR.test(color) ? color : "#008060";
  const ended = Boolean(endsAt) && endsAt <= now;

  let remaining;
  let progress;
  if (!endsAt) {
    remaining = SAMPLE_DURATION_MS - (now % 60_000);
    progress = 0.5;
  } else {
    remaining = Math.max(0, endsAt - now);
    const start = startsAt && startsAt < endsAt ? startsAt : Math.min(now, endsAt);
    progress = endsAt > start ? Math.min(1, remaining / (endsAt - start)) : 0;
  }

  // Rounded up to whole seconds like the storefront countdown, which shows
  // zero only once the timer has ended.
  const shownSeconds = Math.ceil(remaining / 1000);
  const parts = splitDuration(shownSeconds * 1000);
  // What was shown a second ago, for the rolling digits.
  const previousParts = ended ? null : splitDuration((shownSeconds + 1) * 1000);
  const units = [
    ["days", t("TimerPreview.days")],
    ["hours", t("TimerPreview.hours")],
    ["minutes", t("TimerPreview.minutes")],
    ["seconds", t("TimerPreview.seconds")],
  ];

  const classes = ["timer-preview__bar", `timer-preview__bar--${size}`];
  if (ended) classes.push("timer-preview__bar--ended");
  else classes.push(`timer-preview__bar--${urgency}`);

  const timer = (
    <div
      className={classes.join(" ")}
      style={{ "--timer-color": background, "--timer-text": readableTextColor(background) }}
    >
      <p className="timer-preview__message">
        {ended ? t("TimerPreview.ended") : description || t("TimerPreview.defaultMessage")}
      </p>
      <span className="timer-preview__clock" role="timer" aria-live="off">
        {units.map(([unit, label], index) => (
          <span key={unit} className="timer-preview__group">
            {index > 0 && (
              <span className="timer-preview__separator" aria-hidden="true">
                :
              </span>
            )}
            <span className="timer-preview__unit">
              <span className="timer-preview__value">
                {placedDigits(parts[unit], previousParts?.[unit]).map(
                  ({ place, digit, previous }) => (
                    // Keyed by place value, so "100" → "99" days keeps the ones place stable.
                    <Digit key={place} value={digit} previous={previous} />
                  ),
                )}
              </span>
              <span className="timer-preview__label">{label}</span>
            </span>
          </span>
        ))}
      </span>
      <span className="timer-preview__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  );

  // The timer leads the preview, above a light sketch of the product
  // information it sits with on a product page, down to the Buy button.
  return (
    <figure className="timer-preview" aria-label={t("TimerPreview.label")}>
      <div className="timer-preview__page">
        {timer}
        <div className="timer-preview__details" aria-hidden="true">
          <div className="timer-preview__line timer-preview__line--title" />
          <div className="timer-preview__line timer-preview__line--price" />
          <div className="timer-preview__button" />
        </div>
      </div>
    </figure>
  );
}
