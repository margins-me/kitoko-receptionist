import { formatMoney, formatTime } from "@kitoko/ui/format";
import type { Currency } from "@kitoko/ui/format";
import { intlTag } from "@/i18n/locale";
import type { PayBooking, PayState, PayView, When } from "./types";

export const HOLD_SECONDS = 15 * 60;

export const toMs = (value: When): number => (value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));

/** Her time zone: the server's, else London for pounds and Paris (same clock as Milan and Lyon) for euros. */
export const timeZoneOf = (b: PayBooking): string => b.timeZone || (b.currency === "GBP" ? "Europe/London" : "Europe/Paris");

export const money = (cents: number, locale: string, currency: string): string =>
  formatMoney(cents, intlTag(locale), (currency === "GBP" ? "GBP" : "EUR") satisfies Currency);

function parts(ms: number, tz: string, locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone: tz, ...options }).format(ms);
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** "14:00" / "14 h" in her time zone. */
export function timeAt(ms: number, tz: string, locale: string): string {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  return formatTime(hhmm, locale);
}

/** The ticket's date block and lines. */
export function when(b: PayBooking, locale: string) {
  const tz = timeZoneOf(b);
  const start = toMs(b.start);
  const end = toMs(b.end);
  return {
    weekday: capitalise(parts(start, tz, locale, { weekday: "short" })).replace(/\.$/, ""),
    day: parts(start, tz, locale, { day: "numeric" }),
    month: capitalise(parts(start, tz, locale, { month: "short" })).replace(/\.$/, ""),
    date: capitalise(parts(start, tz, locale, { weekday: "long", day: "numeric", month: "long" })),
    from: timeAt(start, tz, locale),
    to: timeAt(end, tz, locale),
  };
}

/** "9:41" left on the hold. */
export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function holdLeft(b: PayBooking, now: number): number {
  return b.holdExpiresAt === null ? 0 : (toMs(b.holdExpiresAt) - now) / 1000;
}

export function viewOf(state: PayState, now: number): PayView {
  const status = state.booking.status;
  if (status === "confirmed" || status === "honoured") return "confirmed";
  if (status === "held") return holdLeft(state.booking, now) > 0 ? "held" : "expired";
  if (status === "expired") return "expired";
  return "cancelled";
}
