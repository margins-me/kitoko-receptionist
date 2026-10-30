import { addDays, localDate, pickText, resolveLocal } from "@kitoko/booking";
import type { Locale } from "@kitoko/booking";
import type { BookingDetail, Pro } from "@kitoko/db";
import { iso, localLabel, moneyText } from "../services/util";

/** A booking as the agents read it: ids, local time, and every amount as cents and as text. */
export function describeBooking(b: BookingDetail, pro: Pro, locale: Locale, opts: { client?: boolean } = {}) {
  const m = (cents: number) => moneyText(cents, locale, b.currency);
  return {
    booking_id: b.id,
    ref: b.ref,
    status: b.status,
    service: b.service.name,
    options: b.selection.lines.filter((l) => l.kind !== "base").map((l) => pickText(l.label, locale)),
    with: b.staff.name,
    start: iso(b.start),
    local: localLabel(b.start, pro.timezone, locale),
    minutes: Math.round((b.end - b.start) / 60_000),
    ...(b.status === "held" && b.holdExpiresAt ? { held_until: localLabel(b.holdExpiresAt, pro.timezone, locale) } : {}),
    ...(b.displacedAt ? { displaced: true } : {}),
    ...(opts.client ? {} : { client: b.client ? { first_name: b.client.firstName, phone: b.client.phoneE164, email: b.client.email } : null, source: b.source }),
    amounts: {
      currency: b.currency,
      price: m(b.priceCents),
      deposit: m(b.depositCents),
      booking_fee: m(b.feeCents),
      balance_at_salon: m(b.balanceCents),
      paid: m(b.money.paidCents),
      refunded: m(b.money.refundedCents),
      ...(b.money.refundPending ? { refund_pending: true } : {}),
      ...(opts.client || b.money.payoutCents === null ? {} : { payout: m(b.money.payoutCents), payout_status: b.money.payoutStatus }),
    },
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** [from, to) in epoch ms for local dates (inclusive) in `tz`; defaults: today and `days` days. */
export function localRange(tz: string, now: number, dateFrom?: string, dateTo?: string, days = 7): { from: number; to: number } | null {
  const first = dateFrom ?? localDate(now, tz);
  const last = dateTo ?? addDays(first, days - 1);
  if (!DATE.test(first) || !DATE.test(last) || last < first) return null;
  try {
    return { from: resolveLocal(first, "00:00", tz).at, to: resolveLocal(addDays(last, 1), "00:00", tz).at };
  } catch {
    return null;
  }
}

/** Like localRange, but the default is the last `days` days up to today (earnings, payouts). */
export function pastRange(tz: string, now: number, dateFrom?: string, dateTo?: string, days = 30): { from: number; to: number } | null {
  if (dateFrom) return localRange(tz, now, dateFrom, dateTo, days);
  const today = dateTo ?? localDate(now, tz);
  return DATE.test(today) ? localRange(tz, now, addDays(today, 1 - days), today) : null;
}
