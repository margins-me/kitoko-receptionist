const NBSP = " ";

// Takes a locale code or BCP 47 tag ("fr", "it-IT"). French writes hours with "h" ("6 h 15", "9 h 30"); English,
// Italian and Spanish write "6 h 15 min" and "9:30". Spaces are non-breaking, so a value never wraps.
const isFrench = (locale: string) => locale.toLowerCase().startsWith("fr");

/** The currencies a pro charges in, as @kitoko/booking's Currency (the UI kit stays free of booking). */
export type Currency = "EUR" | "GBP";

/**
 * "145 €", "4,90 €" (fr, it, es: Intl's own spacing), "€145", "£4.90" (en). The narrow symbol, so French and Spanish
 * write "20 £" rather than "20 £GB" or "20 GBP".
 */
export function formatMoney(cents: number, locale: string, currency: Currency): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** formatMoney in euros. */
export const formatEur = (cents: number, locale: string): string => formatMoney(cents, locale, "EUR");

/** "6 h 15" (fr), "6 h 15 min" (en, it, es); "45 min" and "1 h" everywhere. */
export function formatDuration(minutes: number, locale: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}${NBSP}min`;
  if (m === 0) return `${h}${NBSP}h`;
  return isFrench(locale)
    ? `${h}${NBSP}h${NBSP}${String(m).padStart(2, "0")}`
    : `${h}${NBSP}h${NBSP}${m}${NBSP}min`;
}

/** A local "HH:MM" as "9 h", "15 h 30" (fr) or "9:00", "15:30" (en, it, es). */
export function formatTime(localTime: string, locale: string): string {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(localTime);
  if (!match) throw new RangeError(`Expected "HH:MM", got "${localTime}"`);
  const h = Number(match[1]);
  const mm = match[2] ?? "00";
  if (!isFrench(locale)) return `${h}:${mm}`;
  return mm === "00" ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${mm}`;
}
