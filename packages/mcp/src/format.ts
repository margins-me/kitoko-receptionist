import { addDays, formatMoney, LOCALES, resolveLocal, rulesText } from "@kitoko/booking";
import { TRADES } from "@kitoko/booking/trades";
import type { Currency, Locale, LocalDate, Rules } from "@kitoko/booking";

// Pure helpers of the MCP tools: text matching for search_pros, local dates to instants, amounts and times as an
// outside agent reads them (English, with the pro's time zone).

export { LOCALES };

/** Lower case, no accents, single spaces. */
export const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();

/** The names an agent may use for a seeded city, mapped to the one stored in pros.city (normalized). */
const CITY_ALIASES: Record<string, string> = {
  milano: "milan",
  mailand: "milan",
  londra: "london",
  londres: "london",
  lione: "lyon",
};

const cityKey = (city: string): string => {
  const key = normalize(city);
  return CITY_ALIASES[key] ?? key;
};

/** "Milan" matches "Milan", "milano", "MILAN " and "Milan, Italy". */
export function cityMatches(proCity: string | null, wanted: string): boolean {
  if (!proCity) return false;
  const want = cityKey(wanted.split(",")[0] ?? wanted);
  if (!want) return true;
  return cityKey(proCity) === want;
}

// Very small stemming: "braids" and "braid", "lashes" and "lash" compare equal.
const stem = (word: string): string => word.replace(/(es|s)$/u, "");

const words = (text: string): string[] =>
  normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stem);

const STOP_WORDS = new Set(["and", "with", "the", "for", "per", "des", "les", "una", "con"]);

/** English (and a few French/Italian) words for packages/booking TRADES ids. */
const TRADE_WORDS: Record<string, (typeof TRADES)[number]> = {
  braid: "tresses",
  tress: "tresses",
  trecce: "tresses",
  cornrow: "tresses",
  twist: "tresses",
  wig: "perruques",
  perruque: "perruques",
  nail: "ongles",
  manicure: "ongles",
  pedicure: "ongles",
  ongle: "ongles",
  lash: "cils",
  cil: "cils",
  loc: "locks",
  lock: "locks",
  dreadlock: "locks",
  hair: "coiffure",
  haircut: "coiffure",
  facial: "visage",
  massage: "massage",
  makeup: "maquillage",
  brow: "maquillage",
};

/** The trade ids a free-text service query points at ("box braids" → tresses). */
export const tradesOf = (query: string): string[] => [
  ...new Set(words(query).flatMap((w) => (TRADE_WORDS[w] ? [TRADE_WORDS[w]] : (TRADES as readonly string[]).includes(w) ? [w] : []))),
];

/** Every meaningful word of the query appears in the service name ("knotless braids" ⊂ "Knotless braids"). */
export function serviceMatches(serviceName: string, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const have = new Set(words(serviceName));
  return wanted.every((w) => have.has(w));
}

/** [start of date_from, start of the day after date_to) in the pro's time zone. */
export function localRange(dateFrom: LocalDate, dateTo: LocalDate, tz: string): { from: number; to: number } {
  return { from: resolveLocal(dateFrom, "00:00", tz).at, to: resolveLocal(addDays(dateTo, 1), "00:00", tz).at };
}

/** Days from a to b inclusive (2026-11-01..2026-11-01 = 1). */
export const dayCount = (a: LocalDate, b: LocalDate): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** "Sat 1 Nov, 10:00" in the pro's time zone. */
export function localTime(at: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** An amount both ways: cents for programs, "€85.00" for people. */
export const money = (cents: number, currency: Currency) => ({ cents, text: formatMoney(cents, "en" as Locale, currency) });

/** "240 min" or "240–300 min". */
export const minutesRange = (min: number, max: number): string => (min === max ? `${min} min` : `${min}–${max} min`);

export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "any"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Local start times each part of the day covers, in minutes after midnight: [from, to). */
const PARTS: Record<TimeOfDay, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
  any: [0, 24 * 60],
};

/** Minutes after midnight of an instant in a time zone (10:30 → 630). */
export function minutesOfDay(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

/** Whether a start falls in the part of the day (morning: before 12:00, afternoon: 12:00 to 17:00, evening: after). */
export function inTimeOfDay(at: number, tz: string, part: TimeOfDay): boolean {
  const [from, to] = PARTS[part];
  const m = minutesOfDay(at, tz);
  return m >= from && m < to;
}

/**
 * The pro's cancellation rule as @kitoko/booking writes it in English ("Free cancellation up to 48 hours before;
 * after that the deposit is kept."): the cancellation sentences of rulesText, never a text of our own.
 */
export function cancellationRule(rules: Rules, currency: Currency): string {
  // Settings whose sentences are known and countable: deposit (0 or 1), reschedule (1), cancellation (n), lateness (1).
  const probe: Rules = {
    ...rules,
    lateness: { ...rules.lateness, graceMinutes: 0, feeCents: null, autoCancelAfterMinutes: null },
    companionsAllowed: true,
    extra: [],
  };
  const sentences = rulesText(probe, "en", currency);
  const before = (rules.deposit.mode === "none" ? 0 : 1) + 1;
  const cancellation = sentences.slice(before, -1);
  return cancellation.length > 0 ? cancellation.join(" ") : "Nothing is paid online, so cancelling costs nothing.";
}
