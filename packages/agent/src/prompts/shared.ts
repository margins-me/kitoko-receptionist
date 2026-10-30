import { formatMoney } from "@kitoko/booking/currency";
import type { Currency } from "@kitoko/booking/currency";
import { LOCALES } from "@kitoko/i18n";
import type { Locale } from "@kitoko/i18n";

export type { Currency };

/** What the prompts know about the pro. Everything here comes from the database, never from a conversation. */
export type ProFacts = {
  /** Her business name as clients know it ("Nala Braids"). */
  name: string;
  city: string;
  currency: Currency;
  /** IANA zone of the salon ("Europe/Paris"); every time the agents say is local to it. */
  timezone: string;
};

export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
};

export const LANGUAGE_LIST = LOCALES.map((l) => LANGUAGE_NAMES[l]).join(", ");

/**
 * "Now: Tuesday, 27 October 2026 at 14:05 in Europe/Paris (GMT+01:00). Today is 2026-10-27." This is the part of the
 * system prompt that changes on every request.
 */
export function nowLine(now: number | Date, timeZone: string): string {
  const d = new Date(now);
  const human = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `Now: ${human} in ${timeZone}${offset ? ` (${offset})` : ""}. Today is ${day}.`;
}

// The app's own format (booking's formatMoney); Intl's no-break spaces read as plain spaces in a prompt.
const money = (cents: number, currency: Currency, locale: Locale) => formatMoney(cents, locale, currency).replace(/\s/g, " ");

/** How 45.50 and 30 in the pro's currency are written in each language: "English €45.50 / €30, French 45,50 € / 30 €, …". */
export function moneyExamples(currency: Currency): string {
  return LOCALES.map((l) => `${LANGUAGE_NAMES[l]} ${money(4550, currency, l)} / ${money(3000, currency, l)}`).join(", ");
}

export const moneyRules = (currency: Currency) =>
  [
    `- Amounts in tool results are integer cents in ${currency} (4550 means 45.50). When a tool also gives the amount as text, copy that text.`,
    `- Write amounts the way the reader's language does: ${moneyExamples(currency)}.`,
    "- Never compute, round, estimate or combine amounts yourself. Only state amounts a tool returned.",
  ].join("\n");
