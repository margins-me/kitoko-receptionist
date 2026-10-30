import { DEFAULT_LOCALE, LOCALES } from "@kitoko/i18n";
import { defineRouting } from "next-intl/routing";

/**
 * English has no prefix (/aicha.braids); French, Italian, Spanish and Portuguese live under /fr, /it, /es and /pt.
 * No detection and no cookie: a URL always shows the same language, so a demo link reads the same for every judge.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});

export type { Locale } from "@kitoko/i18n";
