import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

/** Returns the redirect URL if it points at Shopify or this app, otherwise null. */
function safeRedirectUrl(search) {
  const redirectUri = new URLSearchParams(search).get("redirectUri");
  if (!redirectUri) return null;
  try {
    const url = new URL(decodeURIComponent(redirectUri));
    const allowed =
      [window.location.hostname, "admin.shopify.com"].includes(url.hostname) ||
      url.hostname.endsWith(".myshopify.com");
    return allowed ? url : null;
  } catch {
    return null;
  }
}

export default function ExitIframe() {
  const shopify = useAppBridge();
  const { t } = useTranslation();
  const { search } = useLocation();
  const redirectUrl = useMemo(() => safeRedirectUrl(search), [search]);

  useEffect(() => {
    if (!redirectUrl) return;
    shopify.loading(true);
    window.open(redirectUrl, "_top");
  }, [shopify, redirectUrl]);

  if (redirectUrl || !search) return null;

  return (
    <s-page inlineSize="small">
      <s-banner tone="warning" heading={t("ExitIframe.heading")}>
        {t("ExitIframe.body")}
      </s-banner>
    </s-page>
  );
}
