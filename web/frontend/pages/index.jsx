import { useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";

import { AnalyticsCards } from "../components/home/AnalyticsCards";
import { SetupSection } from "../components/home/SetupSection";
import { useAnalytics } from "../hooks/useAnalytics";
import { APP_BLOCK_HANDLE, useTimerBlockAdded } from "../hooks/useTimerBlockAdded";

/** The theme editor, open at the product page template. */
export function themeEditorUrl({ shop }) {
  return `https://${shop}/admin/themes/current/editor?template=product`;
}

/**
 * Theme editor deep link that adds the app block to the main section of the
 * product template, where the merchant can preview, move and save it.
 * https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#app-block-deep-linking
 */
export function addAppBlockUrl({ shop, apiKey }) {
  const params = new URLSearchParams({
    template: "product",
    addAppBlockId: `${apiKey}/${APP_BLOCK_HANDLE}`,
    target: "mainSection",
  });
  return `https://${shop}/admin/themes/current/editor?${params}`;
}

/**
 * The app's home page: the analytics, then the Timer Block section, whose wording
 * follows whether the Timer block is on the published theme.
 */
export default function HomePage() {
  const { t } = useTranslation();
  const shopify = useAppBridge();
  const { shop, apiKey } = shopify.config;
  const blockAdded = useTimerBlockAdded();
  const analytics = useAnalytics();

  return (
    <s-page>
      <s-stack gap="base">
        {analytics.isError ? (
          <s-banner tone="critical" heading={t("HomePage.analytics.loadError")}>
            <s-button slot="secondary-actions" onClick={() => analytics.refetch()}>
              {t("HomePage.analytics.retry")}
            </s-button>
          </s-banner>
        ) : (
          <AnalyticsCards analytics={analytics.data} loading={analytics.isPending} />
        )}

        <SetupSection
          added={blockAdded.data === true}
          addBlockUrl={addAppBlockUrl({ shop, apiKey })}
          themeEditorUrl={themeEditorUrl({ shop })}
        />
      </s-stack>
    </s-page>
  );
}
