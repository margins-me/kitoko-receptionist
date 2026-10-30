import "server-only";
import {
  addDays,
  bookableUntil,
  cancellationSummary,
  checkoutAmounts,
  depositDue,
  effectiveDepositRule,
  localDate,
  quote,
  rescheduleEligibility,
  resolveLocal,
  rulesText,
  staffSlots,
} from "@kitoko/booking";
import type { Currency, Interval, Locale, Quote, Selection, StaffSlot } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import {
  blockTime as dbBlockTime,
  cancelBooking as dbCancelBooking,
  createHold,
  formatRange,
  getAvailabilityInputs,
  getBooking,
  getPro,
  getService,
  markHonoured,
  markNoShow,
  previewCancel,
  releaseHold,
  rescheduleBooking as dbRescheduleBooking,
} from "@kitoko/db";
import type { Actor, BookingDetail, BookingSource, Pro, ServiceListing } from "@kitoko/db";
import { notifyConversation } from "./conversation";
import type { ServicesCtx } from "./ctx";
import { processPayouts, processRefunds } from "./payments";
import { iso, localLabel, logEvent, moneyText, nowMs, toEpoch } from "./util";
import type { When } from "./util";

const DAY = 86_400_000;
/** The furthest findSlots looks in one call (busy_intervals reads at most 62 days). */
const MAX_RANGE = 31 * DAY;
export const MAX_SLOTS = 20;

export type SelectionInput = { options?: Record<string, string>; addons?: string[]; conditionsAccepted?: boolean };

/** The client's choices; unset option groups take their default, conditions count as read (the agent shows them). */
export const toSelection = (s?: SelectionInput | null): Selection => ({
  options: s?.options ?? {},
  addons: s?.addons ?? [],
  conditionsAccepted: s?.conditionsAccepted ?? true,
});

export type Slot = { start: string; end: string; staffIds: string[] };

type Priced = {
  pro: Pro;
  service: ServiceListing;
  selection: Selection;
  quote: Quote;
  depositCents: number;
  feeCents: number;
};

/** Price, duration, deposit and booking fee of a service for a selection: @kitoko/booking only, never the caller. */
async function priced(ctx: ServicesCtx, proId: string, serviceId: string, selection?: SelectionInput | null): Promise<Result<Priced, string>> {
  const [pro, service] = await Promise.all([getPro(ctx.db, proId), getService(ctx.db, proId, serviceId)]);
  if (!pro) return err("pro_not_found");
  if (!service || !service.active) return err("service_not_found");
  const sel = toSelection(selection);
  const q = quote(service, sel);
  if (!q.ok) return q;
  const depositCents = depositDue(q.value.priceCents, effectiveDepositRule(service.deposit, pro.rules, true));
  const amounts = checkoutAmounts({ serviceCents: depositCents, productsCents: 0, deliveryCents: 0, feePayer: pro.rules.feePayer });
  if (!amounts.ok) return amounts;
  const feeCents = pro.rules.feePayer === "client" ? amounts.value.feeCents : 0;
  return ok({ pro, service, selection: sel, quote: q.value, depositCents, feeCents });
}

/**
 * Every free start in [from, to) for a session of `minutes`, with the staff free at it. `exclude` drops one busy
 * interval (the booking being moved) so its own time does not count against it.
 */
export async function freeStarts(
  ctx: ServicesCtx,
  i: { pro: Pro; service: ServiceListing; minutes: number; from: number; to: number; exclude?: { start: number; end: number; staffId: string } },
): Promise<StaffSlot[]> {
  const now = nowMs(ctx);
  const from = Math.max(i.from, now);
  const to = Math.min(i.to, from + MAX_RANGE);
  if (!(to > from)) return [];
  const tz = i.pro.timezone;
  const inputs = await getAvailabilityInputs(ctx.db, { proId: i.pro.id, from: from - DAY, to: to + DAY });
  const busy: Interval[] = [];
  const staffBusy: Record<string, Interval[]> = {};
  for (const b of inputs.busy) {
    const x = i.exclude;
    if (x && b.start === x.start && b.end === x.end && b.staffId === x.staffId) continue;
    if (b.staffId === null) busy.push(b);
    else (staffBusy[b.staffId] ??= []).push(b);
  }
  const window = bookableUntil({ now, tz, window: i.pro.schedule.window, openings: [] });
  const out: StaffSlot[] = [];
  const last = localDate(to, tz);
  for (let date = localDate(from, tz); date <= last; date = addDays(date, 1)) {
    const day = staffSlots({
      tz,
      schedule: i.pro.schedule,
      busy,
      minutes: i.minutes,
      now,
      window,
      date,
      ...(date in inputs.overrides ? { override: inputs.overrides[date] ?? null } : {}),
      staffIds: i.service.staffIds,
      staffBusy,
    });
    for (const s of day.slots) if (s.start >= from && s.start < to) out.push(s);
  }
  return out;
}

/** At most `max` slots spread over the days: each day's earliest first, then each day's next, … */
export function spread<T extends { start: number }>(slots: readonly T[], max: number, tz: string): T[] {
  if (slots.length <= max) return [...slots];
  const days = new Map<string, T[]>();
  for (const s of slots) {
    const d = localDate(s.start, tz);
    const list = days.get(d) ?? [];
    list.push(s);
    days.set(d, list);
  }
  const picked: T[] = [];
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const list of days.values()) {
      const s = list[round];
      if (!s) continue;
      any = true;
      picked.push(s);
      if (picked.length >= max) break;
    }
    if (!any) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

const toSlot = (s: StaffSlot): Slot => ({ start: iso(s.start), end: iso(s.end), staffIds: s.staffIds });

/** Free start times for a service and selection over [from, to), at most `limit` (default 20) spread over the days. */
/** Per day, the free starts closest to a local time ("14:00"): the exact time when free, else its nearest neighbours. */
export function nearestPerDay(slots: readonly StaffSlot[], time: string, tz: string): StaffSlot[] {
  const target = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const gap = (s: StaffSlot) => Math.abs(Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5)) - target);
  const best = new Map<string, StaffSlot[]>();
  for (const s of slots) {
    const d = localDate(s.start, tz);
    const kept = best.get(d);
    if (!kept || gap(s) < gap(kept[0]!)) best.set(d, [s]);
    else if (gap(s) === gap(kept[0]!)) kept.push(s);
  }
  return [...best.values()].flat().sort((a, b) => a.start - b.start);
}

export async function findSlots(
  ctx: ServicesCtx,
  i: { proId: string; serviceId: string; selection?: SelectionInput | null; from: When; to: When; limit?: number; time?: string },
): Promise<Result<Slot[], string>> {
  const p = await priced(ctx, i.proId, i.serviceId, i.selection);
  if (!p.ok) return p;
  const from = toEpoch(i.from, p.value.pro.timezone);
  const to = toEpoch(i.to, p.value.pro.timezone);
  if (Number.isNaN(from) || Number.isNaN(to)) return err("invalid_dates");
  const tz = p.value.pro.timezone;
  const free = await freeStarts(ctx, { pro: p.value.pro, service: p.value.service, minutes: p.value.quote.minutes, from, to });
  const all = i.time ? nearestPerDay(free, i.time, tz) : free;
  return ok(spread(all, i.limit ?? MAX_SLOTS, tz).map(toSlot));
}

export type ServiceQuote = {
  serviceName: string;
  priceCents: number;
  minutes: number;
  depositCents: number;
  /** Kitoko's booking fee, paid by the client on top of the deposit. */
  feeCents: number;
  /** deposit + booking fee: what the client pays online now. */
  totalNowCents: number;
  /** price − deposit: paid at the salon (or by a PayPal invoice). */
  balanceCents: number;
  currency: Currency;
  /** The pro's rules in the client's language (deposit, reschedule, cancellation, lateness...). */
  policySummary: string;
  /** For a given start: free cancellation until a moment, or the share of the deposit kept from now. */
  cancellation?: { kind: "free" } | { kind: "freeUntil"; until: string } | { kind: "keep"; keepPercent: number };
};

/** What a service costs for a selection: price, length, deposit, booking fee and the policy, in the client's language. */
export async function quoteService(
  ctx: ServicesCtx,
  i: { proId: string; serviceId: string; selection?: SelectionInput | null; locale?: Locale; start?: When },
): Promise<Result<ServiceQuote, string>> {
  const p = await priced(ctx, i.proId, i.serviceId, i.selection);
  if (!p.ok) return p;
  const { pro, service, depositCents, feeCents } = p.value;
  const locale = i.locale ?? pro.locale;
  const start = i.start === undefined ? NaN : toEpoch(i.start, pro.timezone);
  let cancellation: ServiceQuote["cancellation"];
  if (!Number.isNaN(start)) {
    const c = cancellationSummary(pro.rules, start, nowMs(ctx));
    cancellation = c.kind === "freeUntil" ? { kind: "freeUntil", until: iso(c.until) } : c;
  }
  return ok({
    serviceName: service.name.fr,
    priceCents: p.value.quote.priceCents,
    minutes: p.value.quote.minutes,
    depositCents,
    feeCents,
    totalNowCents: depositCents + feeCents,
    balanceCents: p.value.quote.priceCents - depositCents,
    currency: pro.currency,
    policySummary: rulesText(pro.rules, locale, pro.currency).join(" "),
    ...(cancellation ? { cancellation } : {}),
  });
}

export type HeldSlot = {
  bookingId: string;
  ref: string;
  start: string;
  end: string;
  staffName: string;
  priceCents: number;
  depositCents: number;
  feeCents: number;
  currency: Currency;
  holdExpiresAt: string;
};

/**
 * Holds a free start (15 minutes on the web, 30 on WhatsApp and MCP: create_hold). The start must be one findSlots
 * offers; amounts come from @kitoko/booking.
 */
export async function holdSlot(
  ctx: ServicesCtx,
  i: {
    proId: string;
    serviceId: string;
    selection?: SelectionInput | null;
    start: When;
    source: BookingSource;
    conversationId?: string | null;
    locale: Locale;
  },
): Promise<Result<HeldSlot, string>> {
  const p = await priced(ctx, i.proId, i.serviceId, i.selection);
  if (!p.ok) return p;
  const { pro, service, quote: q } = p.value;
  const start = toEpoch(i.start, pro.timezone);
  if (Number.isNaN(start)) return err("invalid_start");
  const free = await freeStarts(ctx, { pro, service, minutes: q.minutes, from: start, to: start + 60_000 });
  if (!free.some((s) => s.start === start)) return err("slot_unavailable");

  const hold = await createHold(ctx.db, {
    proId: pro.id,
    serviceId: service.id,
    staffId: null,
    start,
    minutes: q.minutes,
    selection: { selection: p.value.selection, lines: q.lines },
    policy: pro.rules,
    priceCents: q.priceCents,
    depositCents: p.value.depositCents,
    feeCents: p.value.feeCents,
    source: i.source,
    conversationId: i.conversationId ?? null,
    locale: i.locale,
  });
  if (!hold.ok) return hold;
  const booking = await getBooking(ctx.db, hold.value.id);
  if (!booking) return err("not_found");
  return ok({
    bookingId: booking.id,
    ref: booking.ref,
    start: iso(booking.start),
    end: iso(booking.end),
    staffName: booking.staff.name,
    priceCents: booking.priceCents,
    depositCents: booking.depositCents,
    feeCents: booking.feeCents,
    currency: booking.currency,
    holdExpiresAt: iso(hold.value.holdExpiresAt),
  });
}

/** Hold failures that mean "this time is not free": the caller offers alternativesNear instead. */
export const TAKEN_ERRORS: ReadonlySet<string> = new Set(["slot_taken", "slot_unavailable", "slot_blocked", "staff_not_eligible"]);

/**
 * Up to `count` free starts of a service nearest to `start` over that local day and the 6 after it (from now on), in
 * time order: what to offer when that time was just taken (two clients on one slot, a stale search result).
 */
export async function alternativesNear(
  ctx: ServicesCtx,
  i: { proId: string; serviceId: string; selection?: SelectionInput | null; start: When; count?: number },
): Promise<Slot[]> {
  const p = await priced(ctx, i.proId, i.serviceId, i.selection);
  if (!p.ok) return [];
  const tz = p.value.pro.timezone;
  const asked = toEpoch(i.start, tz);
  const around = Number.isNaN(asked) ? nowMs(ctx) : Math.max(asked, nowMs(ctx));
  const from = resolveLocal(localDate(around, tz), "00:00", tz).at;
  const all = await freeStarts(ctx, { pro: p.value.pro, service: p.value.service, minutes: p.value.quote.minutes, from, to: from + 7 * DAY });
  return all
    .filter((s) => s.start !== asked)
    .toSorted((a, b) => Math.abs(a.start - around) - Math.abs(b.start - around) || a.start - b.start)
    .slice(0, i.count ?? 3)
    .toSorted((a, b) => a.start - b.start)
    .map(toSlot);
}

/** Lets go of a hold (the client changed her mind or picked another time). */
export async function releaseSlot(ctx: ServicesCtx, i: { bookingId: string }): Promise<Result<{ released: true }, string>> {
  const r = await releaseHold(ctx.db, i.bookingId);
  return r.ok ? ok({ released: true }) : r;
}

/** Is `start` a free start for this booking's service and length (its own current time not counting)? */
async function isFreeFor(ctx: ServicesCtx, booking: BookingDetail, start: number): Promise<Result<true, string>> {
  const [pro, service] = await Promise.all([getPro(ctx.db, booking.proId), getService(ctx.db, booking.proId, booking.serviceId)]);
  if (!pro || !service) return err("not_found");
  const minutes = Math.round((booking.end - booking.start) / 60_000);
  const free = await freeStarts(ctx, {
    pro,
    service,
    minutes,
    from: start,
    to: start + 60_000,
    exclude: { start: booking.start, end: booking.end, staffId: booking.staffId },
  });
  return free.some((s) => s.start === start) ? ok(true) : err("slot_unavailable");
}

/**
 * Every start a confirmed booking can move to over [from, to): same service and length, her hours and rules, free
 * for an eligible staff member, its own current time not counting. What the calendar shows as drop targets; a drop
 * on one of these passes proposeMove's check.
 */
export async function moveTargets(ctx: ServicesCtx, i: { bookingId: string; from: When; to: When }): Promise<Result<Slot[], string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  if (booking.status !== "confirmed") return err("not_reschedulable");
  const [pro, service] = await Promise.all([getPro(ctx.db, booking.proId), getService(ctx.db, booking.proId, booking.serviceId)]);
  if (!pro || !service) return err("not_found");
  const from = toEpoch(i.from, pro.timezone);
  const to = toEpoch(i.to, pro.timezone);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return err("invalid_dates");
  const free = await freeStarts(ctx, {
    pro,
    service,
    minutes: Math.round((booking.end - booking.start) / 60_000),
    from,
    to,
    exclude: { start: booking.start, end: booking.end, staffId: booking.staffId },
  });
  return ok(free.filter((s) => s.start !== booking.start).map(toSlot));
}

export type Rescheduled = { bookingId: string; ref: string; start: string; end: string; staffName: string; movedFrom: string };

/**
 * Moves a confirmed booking (deposit carried over). A client's own move follows the policy (notice period and number
 * of moves) unless the booking was displaced by the pro; the pro's and the system's moves do not count.
 */
export async function rescheduleBooking(
  ctx: ServicesCtx,
  i: { bookingId: string; start: When; by: Actor },
): Promise<Result<Rescheduled, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  if (booking.status !== "confirmed") return err("not_reschedulable");
  const pro = await getPro(ctx.db, booking.proId);
  if (!pro) return err("not_found");
  const start = toEpoch(i.start, pro.timezone);
  if (Number.isNaN(start)) return err("invalid_start");
  if (start === booking.start) return err("same_time");
  if (i.by === "client" && booking.displacedAt === null) {
    const e = rescheduleEligibility({ startsAt: booking.start, now: nowMs(ctx), count: booking.rescheduleCount, rule: booking.policy.reschedule });
    if (!e.ok) return err(e.reason);
  }
  const free = await isFreeFor(ctx, booking, start);
  if (!free.ok) return free;
  const moved = await dbRescheduleBooking(ctx.db, { bookingId: booking.id, start, by: i.by });
  if (!moved.ok) return moved;
  const after = await getBooking(ctx.db, booking.id);
  if (!after) return err("not_found");
  return ok({ bookingId: after.id, ref: after.ref, start: iso(after.start), end: iso(after.end), staffName: after.staff.name, movedFrom: iso(booking.start) });
}

export type Cancelled = {
  bookingId: string;
  ref: string;
  /** Refunded to the client (deposit part, plus the booking fee when the pro or the system cancels). */
  refundCents: number;
  /** Deposit kept for the pro under the policy. */
  keptCents: number;
  /** Booking fee kept by Kitoko (a client's own cancellation). */
  feeKeptCents: number;
  currency: Currency;
  /** none: nothing was paid; succeeded/pending/failed: the PayPal refund's state. */
  refundStatus: "none" | "succeeded" | "pending" | "failed";
  /** A held booking (not paid yet) is just released. */
  released?: true;
};

export type CancelPreview = {
  bookingId: string;
  ref: string;
  refundCents: number;
  keptCents: number;
  feeKeptCents: number;
  currency: Currency;
  /** A held booking (not paid yet) would just be released. */
  released?: true;
};

/** What cancelBooking would refund and keep if it ran now (SQL preview_cancel, same arithmetic). Changes nothing. */
export async function previewCancellation(ctx: ServicesCtx, i: { bookingId: string; by: Actor }): Promise<Result<CancelPreview, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  const base = { bookingId: booking.id, ref: booking.ref, currency: booking.currency };
  if (booking.status === "held") return ok({ ...base, refundCents: 0, keptCents: 0, feeKeptCents: 0, released: true });
  const p = await previewCancel(ctx.db, { bookingId: booking.id, by: i.by });
  if (!p.ok) return p;
  return ok({ ...base, ...p.value });
}

/** Cancels a booking; SQL computes the money from the policy snapshot; the PayPal refund (and payout) run right away. */
export async function cancelBooking(
  ctx: ServicesCtx,
  i: { bookingId: string; by: Actor; reason?: string },
): Promise<Result<Cancelled, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  const base = { bookingId: booking.id, ref: booking.ref, currency: booking.currency };
  if (booking.status === "held") {
    const r = await releaseHold(ctx.db, booking.id);
    if (!r.ok) return r;
    return ok({ ...base, refundCents: 0, keptCents: 0, feeKeptCents: 0, refundStatus: "none", released: true });
  }
  const c = await dbCancelBooking(ctx.db, { bookingId: booking.id, by: i.by, ...(i.reason ? { reason: i.reason } : {}) });
  if (!c.ok) return c;
  await processRefunds(ctx, { bookingId: booking.id });
  if (c.value.keptCents > 0) await processPayouts(ctx, { bookingId: booking.id });
  const after = (await getBooking(ctx.db, booking.id)) ?? booking;
  const paid = booking.money.paidCents - booking.money.refundedCents;
  const refunds = after.refunds.filter((r) => r.createdAt >= booking.createdAt && !booking.refunds.some((b) => b.id === r.id));
  const refundStatus: Cancelled["refundStatus"] =
    c.value.refundCents === 0 ? "none" : refunds.some((r) => r.status === "pending") ? "pending" : refunds.some((r) => r.status === "failed") ? "failed" : "succeeded";
  return ok({
    ...base,
    refundCents: c.value.refundCents,
    keptCents: c.value.keptCents,
    feeKeptCents: Math.max(0, paid - c.value.refundCents - c.value.keptCents),
    refundStatus,
  });
}

export type Done = {
  bookingId: string;
  ref: string;
  outcome: "honoured" | "no_show";
  payoutCents: number | null;
  payoutStatus: string | null;
  /**
   * Why the payout did not go out now (it stays pending, the daily sweeper retries): no_paypal_email (she has not set
   * her PayPal e-mail), paypal_unavailable (PayPal refused or did not answer). Null when it went out or nothing is due.
   */
  payoutIssue: "no_paypal_email" | "paypal_unavailable" | null;
  currency: Currency;
};

/** Marks a booking done or no-show: queues the deposit payout to the pro and sends it through PayPal Payouts. */
export async function markDone(ctx: ServicesCtx, i: { bookingId: string; outcome: "honoured" | "no_show" }): Promise<Result<Done, string>> {
  const marked = i.outcome === "honoured" ? await markHonoured(ctx.db, i.bookingId) : await markNoShow(ctx.db, i.bookingId);
  if (!marked.ok) return marked;
  const runs = await processPayouts(ctx, { bookingId: i.bookingId });
  const run = runs.ok ? runs.value[0] : undefined;
  const payoutIssue = run?.status === "no_paypal_email" ? "no_paypal_email" : run?.status === "pending" ? "paypal_unavailable" : null;
  const b = await getBooking(ctx.db, i.bookingId);
  if (!b) return err("not_found");
  return ok({
    bookingId: b.id,
    ref: b.ref,
    outcome: i.outcome,
    payoutCents: b.money.payoutCents,
    payoutStatus: b.money.payoutStatus,
    payoutIssue,
    currency: b.currency,
  });
}

/** Up to `count` free times for a booking's service, from now over the next two weeks, on different days first. */
/** `avoid`: intervals already offered to other clients in the same cascade, so two clients are never offered the same time. */
export async function alternativeSlots(
  ctx: ServicesCtx,
  booking: BookingDetail,
  count = 3,
  avoid: { start: number; end: number }[] = [],
): Promise<{ start: string; end: string }[]> {
  const [pro, service] = await Promise.all([getPro(ctx.db, booking.proId), getService(ctx.db, booking.proId, booking.serviceId)]);
  if (!pro || !service) return [];
  const minutes = Math.round((booking.end - booking.start) / 60_000);
  const now = nowMs(ctx);
  const all = await freeStarts(ctx, { pro, service, minutes, from: now, to: now + 14 * DAY });
  const free = all.filter((s) => !avoid.some((a) => s.start < a.end && a.start < s.end));
  return spread(free.length >= count ? free : all, count, pro.timezone).map((s) => ({ start: iso(s.start), end: iso(s.end) }));
}

const slotLabel = (s: { start: string }, pro: Pro, locale: Locale) => ({ start: s.start, local: localLabel(Date.parse(s.start), pro.timezone, locale) });

/**
 * Blocks time (a sick day). Confirmed bookings it covers are displaced; each client is messaged on her channel with
 * three real free times nobody else in the cascade was offered (or a full refund). The refunds that follow need
 * each client's answer.
 */
export async function blockTime(
  ctx: ServicesCtx,
  i: { proId: string; staffId?: string | null; from: When; to: When; label: string },
): Promise<Result<{ blockId?: string; displaced: string[] }, string>> {
  const pro = await getPro(ctx.db, i.proId);
  if (!pro) return err("pro_not_found");
  const from = toEpoch(i.from, pro.timezone);
  const to = toEpoch(i.to, pro.timezone);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return err("invalid_dates");
  if (to - from > 31 * DAY) return err("range_too_long");
  const blocked = await dbBlockTime(ctx.db, { proId: pro.id, staffId: i.staffId ?? null, start: from, end: to, label: i.label });
  if (!blocked.ok) return blocked;
  const displaced = blocked.value.displacedBookingIds;

  const { data: block } = await ctx.db
    .from("blocks")
    .select("id")
    .eq("pro_id", pro.id)
    .eq("during", formatRange(from, to))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await logEvent(ctx, { kind: "system", name: "block_time", proId: pro.id, input: { from: iso(from), to: iso(to), staffId: i.staffId ?? null, label: i.label }, output: { displaced } });

  // One client at a time, in appointment order, so each gets times nobody else in this cascade was offered.
  const offered: { start: number; end: number }[] = [];
  const bookings = (await Promise.all(displaced.map((id) => getBooking(ctx.db, id)))).filter((b) => b !== null).sort((a, b) => a.start - b.start);
  for (const booking of bookings) {
    if (!booking.conversationId) continue;
    const conversationId = booking.conversationId;
    const alternatives = await alternativeSlots(ctx, booking, 3, offered);
    offered.push(...alternatives.map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end) })));
    const locale = booking.client?.locale ?? booking.locale;
    const data = {
      booking_id: booking.id,
      booking_ref: booking.ref,
      service: booking.service.name,
      original_start: iso(booking.start),
      original_local: localLabel(booking.start, pro.timezone, locale),
      reason: i.label,
      alternatives: alternatives.map((s) => slotLabel(s, pro, locale)),
      refund_if_declined: moneyText(booking.money.paidCents - booking.money.refundedCents, locale, booking.currency),
      refund_if_declined_cents: booking.money.paidCents - booking.money.refundedCents,
      deposit_carries_over: true,
    };
    await ctx.defer(() => notifyConversation(ctx, { conversationId, event: "booking_displaced", data }));
  }
  return ok({ ...(block?.id ? { blockId: block.id } : {}), displaced });
}

/** The start the pro proposed for a booking (calendar drag), unless the client declined it since. */
export async function pendingProposal(ctx: ServicesCtx, bookingId: string): Promise<number | null> {
  const { data } = await ctx.db
    .from("agent_events")
    .select("name, input")
    .eq("booking_id", bookingId)
    .eq("kind", "system")
    .in("name", ["reschedule_proposed", "reschedule_declined"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.name !== "reschedule_proposed") return null;
  const start = (data.input as { start?: unknown } | null)?.start;
  return typeof start === "string" ? Date.parse(start) : null;
}

/**
 * The client said no to the time the pro proposed: the booking stays where it was, and the decline is recorded
 * (agent_events, kind system, name reschedule_declined) so the calendar drops the proposal and the pro sees it.
 */
export async function declineProposal(ctx: ServicesCtx, i: { bookingId: string }): Promise<Result<{ bookingId: string; declinedStart: string }, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  const proposed = await pendingProposal(ctx, booking.id);
  if (proposed === null || proposed === booking.start) return err("no_proposal");
  await logEvent(ctx, {
    kind: "system",
    name: "reschedule_declined",
    proId: booking.proId,
    bookingId: booking.id,
    conversationId: booking.conversationId,
    input: { start: iso(proposed), from: iso(booking.start) },
  });
  return ok({ bookingId: booking.id, declinedStart: iso(proposed) });
}

/**
 * The pro dragged a booking: records the proposed start (agent_events, kind system, name reschedule_proposed) and asks
 * the client. Her "yes" lets the agent call reschedule_booking for exactly that start; "no" keeps the booking.
 */
export async function proposeMove(ctx: ServicesCtx, i: { bookingId: string; start: When }): Promise<Result<{ bookingId: string; start: string; notified: boolean }, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  if (booking.status !== "confirmed") return err("not_reschedulable");
  const pro = await getPro(ctx.db, booking.proId);
  if (!pro) return err("not_found");
  const start = toEpoch(i.start, pro.timezone);
  if (Number.isNaN(start)) return err("invalid_start");
  if (start === booking.start) return err("same_time");
  const free = await isFreeFor(ctx, booking, start);
  if (!free.ok) return free;
  await logEvent(ctx, {
    kind: "system",
    name: "reschedule_proposed",
    proId: pro.id,
    bookingId: booking.id,
    conversationId: booking.conversationId,
    input: { start: iso(start), from: iso(booking.start) },
  });
  const conversationId = booking.conversationId;
  if (conversationId) {
    const locale = booking.client?.locale ?? booking.locale;
    const data = {
      booking_id: booking.id,
      booking_ref: booking.ref,
      service: booking.service.name,
      current_start: iso(booking.start),
      current_local: localLabel(booking.start, pro.timezone, locale),
      proposed_start: iso(start),
      proposed_local: localLabel(start, pro.timezone, locale),
    };
    await ctx.defer(() => notifyConversation(ctx, { conversationId, event: "reschedule_proposed", data }));
  }
  return ok({ bookingId: booking.id, start: iso(start), notified: conversationId !== null });
}
