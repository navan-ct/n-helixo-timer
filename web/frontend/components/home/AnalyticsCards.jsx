import { useTranslation } from "react-i18next";

import { formatNumber, percentChange } from "../../utils/format";

/** More impressions is good, fewer is bad. */
const CHANGE_BADGE = {
  up: { tone: "success", icon: "arrow-up" },
  down: { tone: "critical", icon: "arrow-down" },
  none: { tone: "neutral", icon: undefined },
};

/**
 * One metric, as its own card: a label, the number in large type, and a line
 * of context under it. While loading, a spinner stands in for the number, so
 * the cards keep their size.
 *
 * @param {{
 *   label: string,
 *   value?: string,
 *   footnote?: string,
 *   loading?: boolean,
 *   children?: import("react").ReactNode,
 * }} props `children` sits next to the number (the change badge).
 */
function StatCard({ label, value = "", footnote = "", loading = false, children = null }) {
  const { t } = useTranslation();
  return (
    <s-section accessibilityLabel={label}>
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-stack direction="inline" gap="small-200" alignItems="center" minBlockSize="28px">
          {loading ? (
            <s-spinner size="base" accessibilityLabel={t("HomePage.analytics.loading")} />
          ) : (
            <>
              <s-heading fontSize="large-200" accessibilityRole="presentation">
                {value}
              </s-heading>
              {children}
            </>
          )}
        </s-stack>
        {/* A non-breaking space keeps the line's height while loading. */}
        <s-text color="subdued">{loading ? " " : footnote}</s-text>
      </s-stack>
    </s-section>
  );
}

/**
 * How impressions changed from the period before, as a badge. With nothing
 * to compare with, there's no badge.
 * @param {{ current: number, previous: number, days: number }} props
 */
function ChangeBadge({ current, previous, days }) {
  const { t, i18n } = useTranslation();
  const change = percentChange(current, previous, i18n.language);
  if (!change) return null;
  const { tone, icon } = CHANGE_BADGE[change.direction];
  return (
    <>
      <s-badge tone={tone} icon={icon}>
        <span aria-hidden="true">{change.percent}</span>
      </s-badge>
      <s-text accessibilityVisibility="exclusive">
        {t(`HomePage.analytics.change.${change.direction}`, {
          change: change.percent,
          count: days,
        })}
      </s-text>
    </>
  );
}

/**
 * The home page's analytics: impressions in the last 30 days (with the change
 * from the 30 days before), timers running now, and countdowns waiting to start.
 *
 * Each metric is a card (a top-level section) under one "Analytics" heading.
 * A section's own heading would put all three in a single card, so the heading
 * stands on its own, styled and spaced the way Polaris draws a section heading
 * outside its card (like the Timer Block section's): `large` type, 16px above the
 * cards, and the same space above it.
 *
 * @param {{
 *   analytics?: {
 *     impressions: { days: number, current: number, previous: number },
 *     timers: { running: number, scheduled: number, evergreen: number },
 *   },
 *   loading: boolean,
 * }} props
 */
export function AnalyticsCards({ analytics, loading }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const ready = !loading && analytics;

  const impressions = ready ? analytics.impressions : null;
  const timers = ready ? analytics.timers : null;
  const active = timers ? timers.running + timers.evergreen : 0;

  return (
    <s-box paddingBlockStart="large">
      <s-stack gap="base">
        <s-heading fontSize="large">{t("HomePage.analytics.heading")}</s-heading>
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 600px) 1fr 1fr 1fr, 1fr"
            gap="base"
          >
            <StatCard
              label={t("HomePage.analytics.impressions")}
              loading={!ready}
              value={impressions ? formatNumber(impressions.current, locale) : ""}
              footnote={
                impressions ? t("HomePage.analytics.period", { count: impressions.days }) : ""
              }
            >
              {impressions && (
                <ChangeBadge
                  current={impressions.current}
                  previous={impressions.previous}
                  days={impressions.days}
                />
              )}
            </StatCard>
            <StatCard
              label={t("HomePage.analytics.activeTimers")}
              loading={!ready}
              value={timers ? formatNumber(active, locale) : ""}
              footnote={
                !timers
                  ? ""
                  : active === 0
                    ? t("HomePage.analytics.noActiveTimers")
                    : t("HomePage.analytics.activeBreakdown", {
                        countdown: formatNumber(timers.running, locale),
                        evergreen: formatNumber(timers.evergreen, locale),
                      })
              }
            />
            <StatCard
              label={t("HomePage.analytics.scheduledTimers")}
              loading={!ready}
              value={timers ? formatNumber(timers.scheduled, locale) : ""}
              footnote={timers ? t("HomePage.analytics.scheduledNote") : ""}
            />
          </s-grid>
        </s-query-container>
      </s-stack>
    </s-box>
  );
}
