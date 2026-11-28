import { useAppBridge } from "@shopify/app-bridge-react";
import { useQuery } from "@tanstack/react-query";

/** Handle of the app block: extensions/timer-widget/blocks/timer.liquid */
export const APP_BLOCK_HANDLE = "timer";
/** App Bridge answers from the admin quickly; don't leave the page waiting if it can't. */
const TIMEOUT_MS = 5_000;

export const timerBlockQueryKey = ["timer-block-added"];

/**
 * Whether the Timer block is placed on the store's published theme.
 *
 * @param {{ type: string, activations: { handle?: string, status?: string }[] }[]} extensions
 *   What `shopify.app.extensions()` resolves to.
 */
export function isTimerBlockAdded(extensions) {
  return extensions
    .filter((extension) => extension.type === "theme_app_extension")
    .flatMap((extension) => extension.activations)
    .some((activation) => activation.handle === APP_BLOCK_HANDLE && activation.status === "active");
}

/**
 * Whether the merchant has added the Timer block to their theme, read from
 * App Bridge (`shopify.app.extensions()`), which reports the published theme's
 * app blocks without extra access scopes. It's checked again whenever the
 * merchant comes back to the app, for example after saving in the theme editor.
 * https://shopify.dev/docs/api/app-home/apis/authentication-and-data/app-api
 */
export function useTimerBlockAdded() {
  const shopify = useAppBridge();
  return useQuery({
    queryKey: timerBlockQueryKey,
    queryFn: () =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("App Bridge didn't report the app's extensions.")),
          TIMEOUT_MS,
        );
        Promise.resolve()
          .then(() => shopify.app.extensions())
          .then((extensions) => resolve(isTimerBlockAdded(extensions)), reject)
          .finally(() => clearTimeout(timeout));
      }),
    retry: false,
    refetchOnWindowFocus: "always",
  });
}
