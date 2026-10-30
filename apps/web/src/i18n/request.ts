import { hasLocale } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { FALLS_BACK_TO_ENGLISH, withFallback } from "./merge";
import { routing } from "./routing";
import { TIME_ZONE } from "./time-zone";

// Every messages/<locale>/<namespace>.json is bundled and exposed under its file name,
// so a new namespace is a new file and nobody edits a shared one.
const files = import.meta.glob<AbstractIntlMessages>("../../messages/*/*.json", { eager: true, import: "default" });

const own: Record<string, AbstractIntlMessages> = {};
for (const [path, messages] of Object.entries(files)) {
  const [, locale, namespace] = /\/messages\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
  if (locale && namespace) (own[locale] ??= {})[namespace] = messages;
}

// French and English stand alone; Italian, Spanish and Portuguese lie over English, so an untranslated key reads in English.
const messagesByLocale: Record<string, AbstractIntlMessages> = Object.fromEntries(
  routing.locales.map((locale) => [
    locale,
    FALLS_BACK_TO_ENGLISH.includes(locale) ? withFallback(own.en ?? {}, own[locale] ?? {}) : (own[locale] ?? {}),
  ]),
);

export default getRequestConfig(async ({ requestLocale }) => {
  const candidate = await requestLocale;
  const locale = hasLocale(routing.locales, candidate) ? candidate : routing.defaultLocale;
  return { locale, messages: messagesByLocale[locale] ?? {}, timeZone: TIME_ZONE };
});
