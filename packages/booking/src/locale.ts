import { INTL, isLocale, LOCALES } from "@kitoko/i18n";
import type { Locale } from "@kitoko/i18n";
import type { LocalizedText } from "./schemas";

// The languages are @kitoko/i18n's (en, fr, it, es, pt); re-exported for the code that already imports them from here.
export { isLocale, LOCALES };
export type { Locale };

/** The BCP 47 tag Intl formats with for each locale. */
export const intlLocale = (locale: Locale): string => INTL[locale];

/** A pro's own text in the reader's language when she wrote one, else English, else the French she must write. */
export function pickText(text: LocalizedText, locale: Locale): string {
  return (text as Partial<Record<Locale, string>>)[locale] ?? text.en ?? text.fr;
}
