import { DEFAULT_LOCALE, LOCALE_LABELS, toLocale } from "@kitoko/i18n";
import { intlLocale } from "@kitoko/booking/locale";
import type { Locale } from "@kitoko/booking/locale";

// Client-safe locale helpers (no next-intl import).

/** A locale from the URL or a prop: one of ours, English otherwise. */
export const asLocale = (value: unknown): Locale => toLocale(value);

/** The BCP 47 tag Intl formats with, from any locale string (unknown ones format as English). */
export const intlTag = (locale: string): string => intlLocale(asLocale(locale));

/** Each language's own name, so a reader finds hers whatever page she is on. */
export const LANGUAGE_NAMES: Record<Locale, string> = LOCALE_LABELS;

/** A locale-free path in a language: English has no prefix (routing.ts, localePrefix "as-needed"). */
export const localePath = (path: string, locale: Locale): string =>
  locale === DEFAULT_LOCALE ? path : `/${locale}${path === "/" ? "" : path}`;
