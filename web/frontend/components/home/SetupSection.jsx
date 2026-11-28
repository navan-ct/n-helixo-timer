import { useTranslation } from "react-i18next";

import { TimerPreview } from "../timers/TimerPreview";

/**
 * The Timer Block section: getting the Timer block onto the product page. Its
 * layout is the same whether or not the block is on the published theme; only
 * the wording changes. Until the block is added, the main button adds it in
 * the theme editor; once it's added, the button opens the theme editor without
 * adding a second block. While the theme is being checked, or if it can't be
 * checked, the section shows the "add" wording.
 *
 * @param {{
 *   added: boolean,
 *   addBlockUrl: string,
 *   themeEditorUrl: string,
 * }} props
 */
export function SetupSection({ added, addBlockUrl, themeEditorUrl }) {
  const { t } = useTranslation();
  const copy = added ? "HomePage.added" : "HomePage";

  return (
    <s-section heading={t("HomePage.title")}>
      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 640px) 1fr 300px, 1fr"
          gap="large"
          alignItems="start"
        >
          <s-stack gap="base">
            <s-stack gap="small-200">
              <s-heading>{t("HomePage.heading")}</s-heading>
              <s-paragraph>{t(`${copy}.body`)}</s-paragraph>
            </s-stack>
            <s-ordered-list>
              <s-list-item>{t(`${copy}.steps.add`)}</s-list-item>
              <s-list-item>{t("HomePage.steps.move")}</s-list-item>
              <s-list-item>{t("HomePage.steps.create")}</s-list-item>
            </s-ordered-list>
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="primary"
                icon="external"
                href={added ? themeEditorUrl : addBlockUrl}
                target="_blank"
              >
                {added ? t("HomePage.added.openThemeEditor") : t("HomePage.addBlock")}
              </s-button>
              <s-button variant="secondary" href="/countdown-timers">
                {t("HomePage.createCountdownTimer")}
              </s-button>
              <s-button variant="secondary" href="/evergreen-timers">
                {t("HomePage.createEvergreenTimer")}
              </s-button>
            </s-stack>
          </s-stack>
          <TimerPreview color="#008060" size="small" urgency="none" />
        </s-grid>
      </s-query-container>
    </s-section>
  );
}
