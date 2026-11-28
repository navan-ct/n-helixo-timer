import { readableTextColor, splitDuration } from "../core/timer-data.js";

/** Urgency effects play during the final hour, as the admin describes them. */
export const URGENCY_WINDOW_MS = 60 * 60_000;

const UNITS = ["days", "hours", "minutes", "seconds"];

/**
 * One digit that rolls to its new value: the previous glyph slides out as the
 * new one slides in. The glyph's key is its value, so a new value mounts a new
 * element and its CSS animation plays.
 *
 * @param {{ value: string, previous: string | null }} props `previous` is the
 *   digit shown a second earlier, or null to skip the animation.
 */
function Digit({ value, previous }) {
  const rolling = previous !== null && previous !== value;
  return (
    <span class="hx-digit">
      {rolling && (
        <span key={`out-${previous}-${value}`} class="hx-digit__glyph hx-digit__glyph--out">
          {previous}
        </span>
      )}
      <span key={value} class={`hx-digit__glyph${rolling ? " hx-digit__glyph--in" : ""}`}>
        {value}
      </span>
    </span>
  );
}

/** Two-digit (or longer) text for a unit, as digits from the right: ones place first. */
const digitsFromRight = (value) => String(value).padStart(2, "0").split("").reverse();

/** The storefront text is in English, so spoken durations are too. */
const LOCALE = "en";

function formatUnit(value, unit) {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "unit", unit, unitDisplay: "long" }).format(
      value,
    );
  } catch {
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
  }
}

/**
 * What screen readers hear, at minute resolution so it doesn't churn every
 * second (seconds are only spelled out in the final minute).
 */
function spokenDuration({ days, hours, minutes, seconds }) {
  const parts = [];
  if (days) parts.push(formatUnit(days, "day"));
  if (hours) parts.push(formatUnit(hours, "hour"));
  if (minutes) parts.push(formatUnit(minutes, "minute"));
  if (!days && !hours && !minutes) parts.push(formatUnit(seconds, "second"));
  try {
    return new Intl.ListFormat(LOCALE, { style: "long", type: "unit" }).format(parts);
  } catch {
    return parts.join(", ");
  }
}

/**
 * The countdown itself. Presentational: the caller decides what to show and
 * passes the current (server-corrected) time.
 *
 * @param {{
 *   timer: import("../core/timer-data.js").Timer,
 *   now: number,
 *   ended?: boolean,
 *   strings: Record<string, string>,
 * }} props
 */
export function Countdown({ timer, now, ended = false, strings }) {
  const remaining = ended ? 0 : Math.max(0, timer.endsAt - now);
  // Round up to whole seconds, like any countdown: "00:00:01" during the last
  // second, and zero only when the timer has actually ended.
  const shownSeconds = Math.ceil(remaining / 1000);
  const parts = splitDuration(shownSeconds * 1000);
  // What was on screen a second ago, for the rolling animation. A countdown
  // moves one second at a time, so it's known without remembering anything.
  const previousParts = ended ? null : splitDuration((shownSeconds + 1) * 1000);
  const urgent = !ended && remaining <= URGENCY_WINDOW_MS && timer.urgency !== "none";
  const duration = timer.endsAt - timer.startsAt;
  const progress = duration > 0 ? Math.min(1, remaining / duration) : 0;

  const classes = ["hx-timer", `hx-timer--${timer.size}`];
  if (urgent) classes.push("hx-timer--urgent", `hx-timer--${timer.urgency}`);
  if (ended) classes.push("hx-timer--ended");

  const message = ended ? strings.ended : timer.message || strings.message;
  const spoken = ended ? strings.ended : `${message} ${spokenDuration(parts)}`;

  return (
    <div
      class={classes.join(" ")}
      style={{ "--hx-color": timer.color, "--hx-text": readableTextColor(timer.color) }}
    >
      <p class="hx-timer__message">{message}</p>
      <div class="hx-timer__clock" aria-hidden="true">
        {UNITS.map((unit, index) => (
          <div key={unit} class="hx-timer__group">
            {index > 0 && <span class="hx-timer__separator">:</span>}
            <span class="hx-timer__unit">
              <span class="hx-timer__digits">
                {digitsFromRight(parts[unit])
                  .map((digit, place) => (
                    // Keyed by place value, so "100" → "99" days keeps the ones place stable.
                    <Digit
                      key={place}
                      value={digit}
                      previous={
                        previousParts ? (digitsFromRight(previousParts[unit])[place] ?? null) : null
                      }
                    />
                  ))
                  .reverse()}
              </span>
              <span class="hx-timer__label">{strings[unit]}</span>
            </span>
          </div>
        ))}
      </div>
      <p class="hx-sr-only" role="timer">
        {spoken}
      </p>
      <div class="hx-timer__progress" aria-hidden="true">
        <span class="hx-timer__progress-bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
