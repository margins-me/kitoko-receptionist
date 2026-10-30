// Kitoko's languages and how a request picks one. English is the source catalog, the default and the final fallback.
// The device language decides (Accept-Language, read on the server so the first paint is right); a manual choice
// (?lang= or the switcher, saved in the kitoko_locale cookie) always wins over it.

export const LOCALES = ["en", "fr", "it", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The BCP 47 tag Intl formats with. Portuguese is European Portuguese. */
export const INTL: Record<Locale, string> = {
  en: "en-GB",
  fr: "fr-FR",
  it: "it-IT",
  es: "es-ES",
  pt: "pt-PT",
};

export const LOCALE_COOKIE = "kitoko_locale";

/** Each language in its own words, whatever the page's language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
};

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && (LOCALES as readonly string[]).includes(x);
}

/** A stored or passed value as a locale; anything unknown reads as English. */
export const toLocale = (x: unknown): Locale => (isLocale(x) ? x : DEFAULT_LOCALE);

/** The supported locale of a language tag by its primary subtag ("fr-BE" → "fr", "pt-BR" → "pt"), or null. */
const primary = (tag: string): Locale | null => {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
};

/**
 * The first supported locale of an Accept-Language header (q-values rank it, header order breaks ties, q=0 refuses)
 * or of a navigator.languages array (already ranked), by primary subtag. Null when none is supported.
 */
export function matchLocale(input: string | readonly string[] | null | undefined): Locale | null {
  if (!input) return null;
  if (typeof input !== "string") {
    for (const tag of input) {
      const locale = primary(tag);
      if (locale) return locale;
    }
    return null;
  }
  const ranked = input
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = primary(tag);
    if (locale) return locale;
  }
  return null;
}

/** The locale of a request, first hit wins: ?lang=, the cookie, the signed-in pro's, the device's, the surface's fallback. */
export function pickLocale(opts: {
  query?: string | null;
  cookie?: string | null;
  account?: Locale | null;
  acceptLanguage?: string | null;
  fallback: Locale;
}): Locale {
  if (isLocale(opts.query)) return opts.query;
  if (isLocale(opts.cookie)) return opts.cookie;
  if (isLocale(opts.account)) return opts.account;
  return matchLocale(opts.acceptLanguage) ?? opts.fallback;
}

// ponytail: substring list of the crawlers and link-preview bots we care about; extend when a new one shows up.
const BOTS = /googlebot|bingbot|facebookexternalhit|facebot|whatsapp|instagram|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|applebot/i;

/** True for a request detection must not steer: no Accept-Language, or a known crawler / link-preview user agent. */
export function isBot(userAgent: string | null, acceptLanguage: string | null): boolean {
  return !acceptLanguage?.trim() || (userAgent !== null && BOTS.test(userAgent));
}

/**
 * The kitoko_locale cookie for an explicit choice (?lang= or the switcher), never for a detected language:
 * a year, Lax, the whole site, on `domain` (KITOKO_COOKIE_DOMAIN, ".kitoko.page") so the site, pro pages and app share it.
 * Shaped for Next's `cookies().set()` and `response.cookies.set()`.
 */
export function localeCookie(locale: Locale, domain?: string | null) {
  return {
    name: LOCALE_COOKIE,
    value: locale,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

/** Who sent a visitor: the referral or affiliate code of `?via=`, kept for 60 days, the last link clicked winning. */
export const REFERRAL_COOKIE = "kitoko_via";
export const REFERRAL_COOKIE_DAYS = 60;

/** A `?via=` value as a referral code (lowercase letters and digits, 3 to 24), or null when it is not one. */
export function referralCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9]{3,24}$/.test(code) ? code : null;
}

/** The kitoko_via cookie, on `domain` (KITOKO_COOKIE_DOMAIN, ".kitoko.page") so the site and the app share it. */
export function referralCookie(code: string, domain?: string | null) {
  return {
    name: REFERRAL_COOKIE,
    value: code,
    maxAge: 60 * 60 * 24 * REFERRAL_COOKIE_DAYS,
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}
