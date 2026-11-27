import { shouldPolyfill as shouldPolyfillLocale } from "@formatjs/intl-locale/should-polyfill";
import { match } from "@formatjs/intl-localematcher";
import { shouldPolyfill as shouldPolyfillPluralRules } from "@formatjs/intl-pluralrules/should-polyfill";
import ShopifyFormat from "@shopify/i18next-shopify";
import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

/**
 * The default locale for the app.
 */
const DEFAULT_APP_LOCALE = "en";

/**
 * The supported locales for the app. The app is in English only; each locale
 * needs a JSON file in the `locales` folder.
 */
const SUPPORTED_APP_LOCALES = ["en"];

let _userLocale;

/**
 * Retrieves the user's locale from the `locale` request parameter and matches it to supported app locales.
 *
 * Returns the default app locale if the user locale is not supported.
 *
 * @see https://shopify.dev/docs/apps/best-practices/internationalization/getting-started#step-2-get-access-to-the-users-locale
 *
 * @returns {string} User locale
 */
export function getUserLocale() {
  if (_userLocale) {
    return _userLocale;
  }
  const url = new URL(window.location.href);
  const locale = url.searchParams.get("locale") || DEFAULT_APP_LOCALE;
  _userLocale = match([locale], SUPPORTED_APP_LOCALES, DEFAULT_APP_LOCALE);
  return _userLocale;
}

/**
 * @async
 * Asynchronously initializes i18next.
 *
 * Intended to be called before rendering the app to ensure translations are present.
 */
export async function initI18n() {
  await loadIntlPolyfills();
  await initI18next();
}

/**
 * @private
 * @async
 * Asynchronously loads Intl polyfills for the default locale and user locale.
 */
async function loadIntlPolyfills() {
  if (shouldPolyfillLocale()) {
    await import("@formatjs/intl-locale/polyfill");
  }
  const promises = [];
  if (shouldPolyfillPluralRules(DEFAULT_APP_LOCALE)) {
    await import("@formatjs/intl-pluralrules/polyfill-force");
    promises.push(loadIntlPluralRulesLocaleData(DEFAULT_APP_LOCALE));
  }
  if (DEFAULT_APP_LOCALE !== getUserLocale() && shouldPolyfillPluralRules(getUserLocale())) {
    promises.push(loadIntlPluralRulesLocaleData(getUserLocale()));
  }
  await Promise.all(promises);
}

/** Plural rules data for each supported locale. */
const PLURAL_RULES_LOCALE_DATA = {
  en: () => import("@formatjs/intl-pluralrules/locale-data/en"),
};

async function loadIntlPluralRulesLocaleData(locale) {
  return (await PLURAL_RULES_LOCALE_DATA[locale]()).default;
}
/**
 * @private
 * @async
 * Asynchronously initializes i18next.
 * @see https://www.i18next.com/overview/configuration-options
 * @returns Promise of initialized i18next instance
 */
async function initI18next() {
  return await i18next
    .use(initReactI18next)
    .use(ShopifyFormat)
    .use(localResourcesToBackend())
    .init({
      debug: false,
      lng: getUserLocale(),
      fallbackLng: DEFAULT_APP_LOCALE,
      supportedLngs: SUPPORTED_APP_LOCALES,
      interpolation: {
        // React escapes values by default
        escapeValue: false,
      },
      react: {
        // Wait for the locales to be loaded before rendering the app
        // instead of using a Suspense component
        useSuspense: false,
      },
    });
}

function localResourcesToBackend() {
  return resourcesToBackend(async (locale, _namespace) => {
    return (await import(`../locales/${locale}.json`)).default;
  });
}
