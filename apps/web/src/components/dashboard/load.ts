import "server-only";
import { DayHoursSchema, ScheduleSchema } from "@kitoko/booking";
import type { DayHours } from "@kitoko/booking";
import { listBookings, listPendingActions, listProMoney, parseRange } from "@kitoko/db";
import type { BookingDetail, Db } from "@kitoko/db";
import { formatMoney } from "./model";
import type { AgentChange, CalBlock, CalBooking, CascadeOffer, MoneyData, MoneyRow, OpenHours, PendingActionRow, WeekData } from "./model";
import { addDays, dayKey, zonedParts } from "./time";

// Reads for the dashboard, with the pro's own client (RLS: she only ever sees her rows).

export function toCalBooking(b: BookingDetail): CalBooking {
  const deposit = b.payments.find((p) => p.kind === "deposit") ?? null;
  const refund = b.refunds.at(-1) ?? null;
  return {
    id: b.id,
    ref: b.ref,
    staffId: b.staffId,
    staffName: b.staff.name,
    start: b.start,
    end: b.end,
    status: b.status,
    holdExpiresAt: b.holdExpiresAt,
    displacedAt: b.displacedAt,
    movedFrom: b.movedFrom,
    clientName: b.client?.firstName ?? null,
    serviceName: b.service.name,
    priceCents: b.priceCents,
    depositCents: b.depositCents,
    feeCents: b.feeCents,
    balanceCents: b.balanceCents,
    balancePaid: b.payments.some((p) => p.kind === "balance" && p.status === "captured"),
    currency: b.currency,
    language: (b.client?.locale ?? b.locale).slice(0, 2).toUpperCase(),
    source: b.source,
    paymentStatus: deposit?.status ?? "none",
    paidCents: b.money.paidCents,
    refundStatus: refund?.status ?? "none",
    refundedCents: b.money.refundedCents,
    payoutStatus: b.money.payoutStatus,
    payoutCents: b.money.payoutCents,
    cancelledBy: b.cancelledBy,
    conversationId: b.conversationId,
  };
}

/**
 * Moves the pro proposed by dragging (agent_events "reschedule_proposed", written by proposeMove) that the client has
 * not answered: the booking is still where it was, she has not declined it (reschedule_declined) and has not written
 * since.
 */
async function loadProposals(db: Db, proId: string, bookings: CalBooking[]): Promise<Record<string, number>> {
  const live = bookings.filter((b) => b.status === "confirmed");
  if (live.length === 0) return {};
  const { data } = await db
    .from("agent_events")
    .select("booking_id, name, input, created_at")
    .eq("pro_id", proId)
    .eq("kind", "system")
    .in("name", ["reschedule_proposed", "reschedule_declined"])
    .in("booking_id", live.map((b) => b.id))
    .order("id", { ascending: false })
    .throwOnError();
  const out: Record<string, number> = {};
  const seen = new Set<string>();
  await Promise.all(
    data.map(async (row) => {
      if (!row.booking_id || seen.has(row.booking_id)) return;
      seen.add(row.booking_id);
      // The latest event wins: a decline after the proposal clears it.
      if (row.name !== "reschedule_proposed") return;
      const booking = live.find((b) => b.id === row.booking_id);
      const input = row.input as { start?: unknown; from?: unknown } | null;
      if (!booking || typeof input?.start !== "string" || typeof input.from !== "string") return;
      if (Date.parse(input.from) !== booking.start) return;
      if (booking.conversationId) {
        const { data: reply } = await db
          .from("conversation_messages")
          .select("id")
          .eq("conversation_id", booking.conversationId)
          .eq("role", "user")
          .eq("visible", true)
          .gt("created_at", row.created_at)
          .limit(1);
        if (reply && reply.length > 0) return;
      }
      out[booking.id] = Date.parse(input.start);
    }),
  );
  return out;
}

/**
 * The times the receptionist offered each displaced booking's client: the alternatives of the latest
 * event.booking_displaced it was given (blockTime → notifyConversation logs them), while the booking still waits.
 */
async function loadOffers(db: Db, proId: string, bookings: CalBooking[]): Promise<Record<string, CascadeOffer>> {
  const waiting = bookings.filter((b) => b.status === "confirmed" && b.displacedAt !== null);
  if (waiting.length === 0) return {};
  const { data } = await db
    .from("agent_events")
    .select("booking_id, input, created_at")
    .eq("pro_id", proId)
    .eq("kind", "system")
    .eq("name", "event.booking_displaced")
    .in("booking_id", waiting.map((b) => b.id))
    .order("id", { ascending: false })
    .throwOnError();
  const out: Record<string, CascadeOffer> = {};
  for (const row of data) {
    if (!row.booking_id || out[row.booking_id]) continue;
    const input = row.input as { alternatives?: unknown } | null;
    const list = Array.isArray(input?.alternatives) ? (input.alternatives as unknown[]) : [];
    const starts = list
      .map((a) => (a && typeof a === "object" && typeof (a as { start?: unknown }).start === "string" ? Date.parse((a as { start: string }).start) : Number.NaN))
      .filter((t) => Number.isFinite(t));
    out[row.booking_id] = { at: Date.parse(row.created_at), starts: [...new Set(starts)].toSorted((a, b) => a - b) };
  }
  return out;
}

/**
 * Bookings the receptionist changed on the client's answer: its latest successful reschedule_booking (the booking was
 * moved) or cancel_booking (the booking is cancelled) tool call. The calendar marks them with ✦.
 */
async function loadAgentChanges(db: Db, proId: string, bookings: CalBooking[]): Promise<Record<string, AgentChange>> {
  if (bookings.length === 0) return {};
  const { data } = await db
    .from("agent_events")
    .select("booking_id, name, input, output, created_at")
    .eq("pro_id", proId)
    .eq("kind", "tool")
    .in("name", ["reschedule_booking", "cancel_booking"])
    .in("booking_id", bookings.map((b) => b.id))
    .order("id", { ascending: false })
    .throwOnError();
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const out: Record<string, AgentChange> = {};
  const seen = new Set<string>();
  for (const row of data) {
    const b = row.booking_id ? byId.get(row.booking_id) : undefined;
    if (!b || seen.has(b.id)) continue;
    const status = (row.output as { status?: unknown } | null)?.status;
    if (row.name === "reschedule_booking" && status === "confirmed") {
      seen.add(b.id);
      if (b.movedFrom !== null && b.status !== "cancelled") out[b.id] = { kind: "moved", at: Date.parse(row.created_at) };
    } else if (row.name === "cancel_booking" && status === "cancelled") {
      seen.add(b.id);
      if (b.status === "cancelled") out[b.id] = { kind: "cancelled", at: Date.parse(row.created_at) };
    }
  }
  return out;
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toOpenHours = (d: DayHours | null): OpenHours =>
  d ? { open: minutes(d.open), close: minutes(d.close), breaks: d.breaks.map((b) => ({ from: minutes(b.from), to: minutes(b.to) })) } : null;

/**
 * Her opening hours for each day of the week (the calendar shades the rest): the weekly schedule, with the day
 * overrides on top. Empty when the schedule cannot be read (nothing is shaded then).
 */
async function loadHours(db: Db, proId: string, weekStart: number): Promise<Record<string, OpenHours>> {
  const { data: pro } = await db.from("pros").select("schedule, timezone").eq("id", proId).maybeSingle();
  const schedule = ScheduleSchema.safeParse(pro?.schedule);
  if (!pro || !schedule.success) return {};
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, pro.timezone));
  const keys = days.map((d) => dayKey(d, pro.timezone));
  const { data: overrides } = await db.from("day_overrides").select("day, hours").eq("pro_id", proId).gte("day", keys[0] ?? "").lte("day", keys[6] ?? "");
  const override = new Map((overrides ?? []).map((o) => [o.day, DayHoursSchema.nullable().safeParse(o.hours)]));
  return Object.fromEntries(
    days.map((d, i) => {
      const key = keys[i] as string;
      const found = override.get(key);
      const weekly = schedule.data.weekly[WEEKDAY_KEYS[zonedParts(d, pro.timezone).weekday - 1] ?? "mon"];
      return [key, toOpenHours(found?.success ? found.data : weekly)];
    }),
  );
}

export async function loadWeek(db: Db, proId: string, weekStart: number, weekEnd: number): Promise<WeekData> {
  const [bookings, blocks, actions, hours] = await Promise.all([
    listBookings(db, proId, weekStart, weekEnd),
    db
      .from("blocks")
      .select("id, staff_id, during, label")
      .eq("pro_id", proId)
      .overlaps("during", `[${new Date(weekStart).toISOString()},${new Date(weekEnd).toISOString()})`)
      .throwOnError(),
    listPendingActions(db, proId, { status: "pending", limit: 20 }),
    loadHours(db, proId, weekStart).catch(() => ({})),
  ]);
  const calBookings = bookings.map(toCalBooking);
  const [proposals, offers, agentChanges] = await Promise.all([
    loadProposals(db, proId, calBookings),
    loadOffers(db, proId, calBookings).catch(() => ({})),
    loadAgentChanges(db, proId, calBookings).catch(() => ({})),
  ]);
  return {
    weekStart,
    weekEnd,
    bookings: calBookings,
    proposals,
    offers,
    agentChanges,
    hours,
    blocks: blocks.data.map((row): CalBlock => ({ id: row.id, staffId: row.staff_id, label: row.label, ...parseRange(String(row.during)) })),
    pendingActions: actions.map(
      (a): PendingActionRow => ({
        id: a.id,
        kind: a.kind,
        summary: a.summary,
        amountCents: a.amountCents,
        currency: a.currency,
        bookingId: a.bookingId,
        createdAt: a.createdAt,
      }),
    ),
  };
}

const REASONS: Record<string, string> = {
  client_cancel: "Client cancelled",
  pro_cancel: "Cancelled by you",
  system_cancel: "Cancelled automatically",
  slot_lost: "Slot lost while paying",
};
const humanReason = (reason: string) => REASONS[reason] ?? (reason.includes("_") ? reason.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : reason);

const PAYMENT_DETAIL: Record<string, string> = { deposit: "Deposit + booking fee", balance: "Balance" };

/** This week's payments, refunds and payouts, newest first, with totals from our own rows. */
export async function loadMoneyRows(db: Db, proId: string, from: number, to: number): Promise<Pick<MoneyData, "currency" | "rows" | "totals">> {
  const money = await listProMoney(db, proId, { from, to });
  const ids = [...new Set([...money.payments, ...money.refunds, ...money.payouts].map((r) => r.bookingId))];
  const refs = new Map<string, { ref: string; client: string | null }>();
  if (ids.length > 0) {
    const { data } = await db.from("bookings").select("id, ref, clients (first_name)").in("id", ids).throwOnError();
    for (const row of data) {
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      refs.set(row.id, { ref: row.ref, client: client?.first_name ?? null });
    }
  }
  const meta = (bookingId: string) => ({ ref: refs.get(bookingId)?.ref ?? null, clientName: refs.get(bookingId)?.client ?? null });
  const rows: MoneyRow[] = [
    ...money.payments.map((p) => ({
      id: p.id,
      type: "payment" as const,
      bookingId: p.bookingId,
      ...meta(p.bookingId),
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      detail: `${PAYMENT_DETAIL[p.kind] ?? p.kind}${p.feeCents > 0 ? ` (fee ${formatMoney(p.feeCents, p.currency)})` : ""}`,
      at: p.capturedAt ?? p.createdAt,
      paypalId: p.captureId,
    })),
    ...money.refunds.map((r) => ({
      id: r.id,
      type: "refund" as const,
      bookingId: r.bookingId,
      ...meta(r.bookingId),
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      detail: humanReason(r.reason),
      at: r.createdAt,
      paypalId: r.paypalRefundId,
    })),
    ...money.payouts.map((p) => ({
      id: p.id,
      type: "payout" as const,
      bookingId: p.bookingId,
      ...meta(p.bookingId),
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      detail: p.reason === "honoured" ? "Appointment done" : p.reason === "no_show" ? "No-show" : "Late cancellation",
      at: p.createdAt,
      paypalId: p.payoutItemId,
    })),
  ].toSorted((a, b) => b.at - a.at);
  const captured = money.payments.filter((p) => p.status === "captured" || p.status === "refunded");
  return {
    currency: money.currency,
    rows,
    totals: {
      capturedCents: captured.reduce((s, p) => s + p.amountCents, 0),
      feesCents: captured.reduce((s, p) => s + p.feeCents, 0),
      refundedCents: money.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amountCents, 0),
      paidOutCents: money.payouts.filter((p) => p.status === "succeeded" || p.status === "sent").reduce((s, p) => s + p.amountCents, 0),
      pendingPayoutCents: money.payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amountCents, 0),
    },
  };
}
