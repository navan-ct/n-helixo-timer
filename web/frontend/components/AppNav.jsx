import { useTranslation } from "react-i18next";

/**
 * The app's navigation in the Shopify admin sidebar. The app name already links
 * to the home page (/), so home doesn't get its own item.
 * https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav
 */
export function AppNav() {
  const { t } = useTranslation();
  return (
    <s-app-nav>
      <s-link href="/countdown-timers">{t("NavigationMenu.countdownTimers")}</s-link>
    </s-app-nav>
  );
}
