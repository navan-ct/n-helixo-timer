import { useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";

import { TimerPreview } from "../components/timers/TimerPreview";

/** Handle of the app block: extensions/timer-widget/blocks/timer.liquid */
const APP_BLOCK_HANDLE = "timer";

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

export default function HomePage() {
  const { t } = useTranslation();
  const shopify = useAppBridge();
  const editorUrl = addAppBlockUrl({ shop: shopify.config.shop, apiKey: shopify.config.apiKey });

  return (
    <s-page>
      <s-section>
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 640px) 1fr 300px, 1fr"
            gap="large"
            alignItems="center"
          >
            <s-stack gap="base">
              <s-stack gap="small-200">
                <s-heading>{t("HomePage.heading")}</s-heading>
                <s-paragraph>{t("HomePage.body")}</s-paragraph>
              </s-stack>
              <s-ordered-list>
                <s-list-item>{t("HomePage.steps.add")}</s-list-item>
                <s-list-item>{t("HomePage.steps.move")}</s-list-item>
                <s-list-item>{t("HomePage.steps.create")}</s-list-item>
              </s-ordered-list>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="primary" icon="external" href={editorUrl} target="_blank">
                  {t("HomePage.addBlock")}
                </s-button>
                <s-button variant="tertiary" href="/countdown-timers">
                  {t("HomePage.createTimer")}
                </s-button>
              </s-stack>
            </s-stack>
            <TimerPreview color="#008060" size="small" position="top" urgency="none" />
          </s-grid>
        </s-query-container>
      </s-section>
    </s-page>
  );
}
