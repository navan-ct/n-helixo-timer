import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { splitDuration } from "../../utils/time";
import { HEX_COLOR, readableTextColor } from "../../utils/timerForm";

import "./TimerPreview.css";

const SAMPLE_DURATION_MS = ((2 * 24 + 14) * 3600 + 33 * 60 + 12) * 1000;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Live, approximate preview of how the countdown bar will look on a product
 * page. It's app-owned markup (not a Polaris component) because it mimics the
 * storefront rather than the admin.
 *
 * @param {{ color: string, size: string, position: string, urgency: string,
 *   description?: string, endsAt?: number | null }} props
 *   `endsAt` is a UTC timestamp; when absent the preview shows sample values.
 */
export function TimerPreview({ color, size, position, urgency, description, endsAt }) {
  const { t } = useTranslation();
  const now = useNow();

  const background = HEX_COLOR.test(color) ? color : "#008060";
  const remaining =
    endsAt && endsAt > now ? endsAt - now : endsAt ? 0 : SAMPLE_DURATION_MS - (now % 60_000);
  const { days, hours, minutes, seconds } = splitDuration(remaining);
  const units = [
    [days, t("TimerPreview.days")],
    [hours, t("TimerPreview.hours")],
    [minutes, t("TimerPreview.minutes")],
    [seconds, t("TimerPreview.seconds")],
  ];

  const bar = (
    <div
      className={`timer-preview__bar timer-preview__bar--${size} timer-preview__bar--${urgency}`}
      style={{ "--timer-color": background, color: readableTextColor(background) }}
    >
      <span className="timer-preview__message">
        {description?.split("\n")[0] || t("TimerPreview.defaultMessage")}
      </span>
      <span className="timer-preview__clock" role="timer" aria-live="off">
        {units.map(([value, label]) => (
          <span key={label} className="timer-preview__unit">
            <span className="timer-preview__value">{String(value).padStart(2, "0")}</span>
            <span className="timer-preview__label">{label}</span>
          </span>
        ))}
      </span>
    </div>
  );

  return (
    <figure className="timer-preview" aria-label={t("TimerPreview.label")}>
      <div className="timer-preview__page">
        {position === "top" && bar}
        <div className="timer-preview__product" aria-hidden="true">
          <div className="timer-preview__image" />
          <div className="timer-preview__details">
            <div className="timer-preview__line timer-preview__line--title" />
            <div className="timer-preview__line timer-preview__line--price" />
            <div className="timer-preview__line" />
            <div className="timer-preview__line timer-preview__line--short" />
            <div className="timer-preview__button" />
          </div>
        </div>
        {position === "bottom" && bar}
      </div>
    </figure>
  );
}
