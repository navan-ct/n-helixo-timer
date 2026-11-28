/** Formats a count for the merchant's locale, e.g. "12,480". */
export function formatNumber(value, locale) {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * The change from `previous` to `current`, rounded to a whole percent.
 * Returns null when there's nothing to compare with (`previous` is 0).
 *
 * @returns {{ direction: "up" | "down" | "none", percent: string } | null}
 *   `percent` is the size of the change, formatted for the locale, e.g. "12%".
 */
export function percentChange(current, previous, locale) {
  if (!previous) return null;
  const ratio = (current - previous) / previous;
  const rounded = Math.round(Math.abs(ratio) * 100) / 100;
  const direction = rounded === 0 ? "none" : ratio > 0 ? "up" : "down";
  return {
    direction,
    percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
      rounded,
    ),
  };
}
