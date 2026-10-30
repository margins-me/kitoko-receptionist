import { toLocale } from "@kitoko/i18n";
import { RulesSchema, SelectionSnapshotSchema } from "@kitoko/booking";
import type { Interval, Locale, Rules, SelectionSnapshot } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import type { Db } from "./clients";
import { dbError } from "./errors";
import { formatRange, parseRange } from "./range";
import {
  ACTORS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  bookingMoney,
  CURRENCIES,
  epochOrNull,
  one,
  oneOf,
  oneOfOrNull,
  PAYMENT_COLUMNS,
  PAYOUT_COLUMNS,
  REFUND_COLUMNS,
  toPayment,
  toPayout,
  toRefund,
} from "./rows";
import type {
  Actor,
  BookingMoney,
  BookingSource,
  BookingStatus,
  Currency,
  Embedded,
  Payment,
  PaymentRow,
  Payout,
  PayoutRow,
  Refund,
  RefundRow,
} from "./rows";

// ---------------------------------------------------------------------------------------------------------------
// SQL functions
// ---------------------------------------------------------------------------------------------------------------

export type HoldInput = {
  proId: string;
  serviceId: string;
  /** Null or absent: the first eligible staff member who is free. */
  staffId?: string | null;
  start: number;
  minutes: number;
  /** What she picked, prices frozen (quote() in @kitoko/booking). */
  selection: SelectionSnapshot;
  /** The pro's rules at booking time. */
  policy: Rules;
  priceCents: number;
  depositCents: number;
  /** bookingFee(depositCents) in @kitoko/booking. */
  feeCents: number;
  source: BookingSource;
  conversationId?: string | null;
  /** The language she books in; default the pro's. */
  locale?: Locale;
};

export type Hold = { id: string; ref: string; staffId: string; holdExpiresAt: number };

/** Holds a slot: 15 minutes on the web, 30 on WhatsApp and MCP (create_hold). Use the service client. */
export async function createHold(
  db: Db,
  input: HoldInput,
): Promise<Result<Hold, "slot_taken" | "slot_blocked" | "too_many_holds" | "staff_not_eligible" | "not_found">> {
  const { data, error } = await db.rpc("create_hold", {
    p_pro_id: input.proId,
    p_service_id: input.serviceId,
    p_staff_id: input.staffId ?? undefined,
    p_start: new Date(input.start).toISOString(),
    p_minutes: input.minutes,
    p_selection: input.selection,
    p_policy: input.policy,
    p_price_cents: input.priceCents,
    p_deposit_cents: input.depositCents,
    p_fee_cents: input.feeCents,
    p_source: input.source,
    p_conversation_id: input.conversationId ?? undefined,
    p_locale: input.locale,
  });
  if (error) return err(dbError(error, ["23P01", "KT001", "KT005", "KT030", "P0002"]));
  const row = data[0];
  if (!row) throw new Error("create_hold returned no row");
  return ok({ id: row.id, ref: row.ref, staffId: row.staff_id, holdExpiresAt: Date.parse(row.hold_expires_at) });
}

/** Lets go of a hold the agent replaced. Idempotent on an expired hold. */
export async function releaseHold(db: Db, bookingId: string): Promise<Result<void, "not_found" | "not_held">> {
  const { error } = await db.rpc("release_hold", { p_booking_id: bookingId });
  if (error) return err(dbError(error, ["P0002", "KT003"]));
  return ok(undefined);
}

export type ConfirmInput = {
  bookingId: string;
  firstName: string;
  /** E.164, already normalised by the app. */
  phoneE164?: string | null;
  email?: string | null;
  locale?: Locale | null;
};

/**
 * Confirms a hold (re-taking a lapsed one when its slot is still free) and records the client. Idempotent.
 * PayPal captures go through paypalCaptureCompleted, which calls it.
 */
export async function confirmBooking(
  db: Db,
  input: ConfirmInput,
): Promise<Result<{ clientId: string }, "slot_taken" | "slot_blocked" | "not_held" | "not_found" | "staff_not_eligible" | "invalid_argument">> {
  const { data, error } = await db.rpc("confirm_booking", {
    p_booking_id: input.bookingId,
    p_first_name: input.firstName,
    p_phone: input.phoneE164 ?? undefined,
    p_email: input.email ?? undefined,
    p_locale: input.locale ?? undefined,
  });
  if (error) return err(dbError(error, ["23P01", "KT001", "KT003", "P0002", "KT030", "22023"]));
  return ok({ clientId: data });
}

/**
 * Moves a confirmed booking to `start` (same length), keeping its staff member when free. Clears displaced_at; the
 * deposit stays. A client's own move counts against the policy (the notice period is the app's to check).
 */
export async function rescheduleBooking(
  db: Db,
  input: { bookingId: string; start: number; by: Actor },
): Promise<Result<{ staffId: string }, "slot_taken" | "slot_blocked" | "not_reschedulable" | "not_found" | "staff_not_eligible">> {
  const { data, error } = await db.rpc("reschedule_booking", {
    p_booking_id: input.bookingId,
    p_start: new Date(input.start).toISOString(),
    p_by: input.by,
  });
  if (error) return err(dbError(error, ["23P01", "KT001", "KT006", "P0002", "KT030"]));
  return ok({ staffId: data });
}

/**
 * Cancels a confirmed booking. SQL works out the money from the policy snapshot and queues the refund (and the
 * payout of a kept deposit); the PayPal refund itself is the app's (listPendingRefunds / refundFinished).
 */
export async function cancelBooking(
  db: Db,
  input: { bookingId: string; by: Actor; reason?: string },
): Promise<Result<{ refundCents: number; keptCents: number }, "not_cancellable" | "not_found">> {
  const { data, error } = await db.rpc("cancel_booking", {
    p_booking_id: input.bookingId,
    p_by: input.by,
    p_reason: input.reason,
  });
  if (error) return err(dbError(error, ["KT007", "P0002"]));
  const row = data[0];
  if (!row) throw new Error("cancel_booking returned no row");
  return ok({ refundCents: row.refund_cents, keptCents: row.kept_cents });
}

/** What cancelBooking would refund and keep right now, without cancelling (same SQL arithmetic). Service client. */
export async function previewCancel(
  db: Db,
  input: { bookingId: string; by: Actor },
): Promise<Result<{ refundCents: number; keptCents: number; feeKeptCents: number }, "not_cancellable" | "not_found">> {
  const { data, error } = await db.rpc("preview_cancel", { p_booking_id: input.bookingId, p_by: input.by });
  if (error) return err(dbError(error, ["KT007", "P0002"]));
  const row = data[0];
  if (!row) throw new Error("preview_cancel returned no row");
  return ok({ refundCents: row.refund_cents, keptCents: row.kept_cents, feeKeptCents: row.fee_kept_cents });
}

/**
 * The deposit page was opened: a held booking's hold runs at least 15 more minutes from now, once per booking (never
 * shortened). Returns the hold's end, null when the booking is not held. Service client.
 */
export async function refreshHoldOnOpen(db: Db, bookingId: string): Promise<Result<number | null, "not_found">> {
  const { data, error } = await db.rpc("refresh_hold_on_open", { p_booking_id: bookingId });
  if (error) return err(dbError(error, ["P0002"]));
  return ok(data ? Date.parse(data) : null);
}

/** Done: queues the payout of the deposit. Service client, or the pro's own client. Idempotent. */
export async function markHonoured(db: Db, bookingId: string): Promise<Result<{ payoutId: string | null }, "not_found" | "not_markable">> {
  const { data, error } = await db.rpc("mark_honoured", { p_booking_id: bookingId });
  if (error) return err(dbError(error, ["P0002", "KT018"]));
  return ok({ payoutId: data ?? null });
}

/** No-show (after the start): queues the payout of the deposit. Service client, or the pro's own client. */
export async function markNoShow(db: Db, bookingId: string): Promise<Result<{ payoutId: string | null }, "not_found" | "not_markable">> {
  const { data, error } = await db.rpc("mark_no_show", { p_booking_id: bookingId });
  if (error) return err(dbError(error, ["P0002", "KT018"]));
  return ok({ payoutId: data ?? null });
}

/**
 * Sick day: blocks [start, end) for one staff member (or the whole business), lets go of live holds there and marks
 * the confirmed bookings it covers as displaced. Returns their ids, in time order.
 */
export async function blockTime(
  db: Db,
  input: { proId: string; staffId?: string | null; start: number; end: number; label?: string },
): Promise<Result<{ displacedBookingIds: string[] }, "not_found">> {
  const { data, error } = await db.rpc("block_time", {
    p_pro_id: input.proId,
    p_staff_id: input.staffId ?? undefined,
    p_during: formatRange(input.start, input.end),
    p_label: input.label,
  });
  if (error) return err(dbError(error, ["P0002"]));
  return ok({ displacedBookingIds: data });
}

/** A busy interval; staffId null for a block that closes the whole business. */
export type BusyInterval = Interval & { staffId: string | null };

/** Live bookings and blocks over [from, to) (at most 62 days), of one staff member or all. Anon client for a live pro. */
export async function busyIntervals(
  db: Db,
  i: { proId: string; staffId?: string | null; from: number; to: number },
): Promise<BusyInterval[]> {
  const { data, error } = await db.rpc("busy_intervals", {
    p_pro_id: i.proId,
    p_staff_id: i.staffId ?? undefined,
    p_from: new Date(i.from).toISOString(),
    p_to: new Date(i.to).toISOString(),
  });
  if (error) throw error;
  return data.map((row) => ({ ...parseRange(String(row.during)), staffId: row.staff_id }));
}

/**
 * The demo button: wipes the pro's activity and rebuilds her seeded week. Service client, or the pro's own client.
 * Reset demo before filming: a rehearsed sick-day cascade offers its displaced clients the nearest free times, which
 * can take next Saturday morning, the slot the knotless booking scene needs.
 */
export async function resetDemo(db: Db, proId: string): Promise<Result<void, "forbidden" | "not_found">> {
  const { error } = await db.rpc("reset_demo", { p_pro_id: proId });
  if (error) return err(dbError(error, ["42501", "P0002"]));
  return ok(undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

export type BookingDetail = {
  id: string;
  /** 6 characters shown to clients. */
  ref: string;
  proId: string;
  staffId: string;
  serviceId: string;
  clientId: string | null;
  conversationId: string | null;
  status: BookingStatus;
  start: number;
  end: number;
  holdExpiresAt: number | null;
  source: BookingSource;
  selection: SelectionSnapshot;
  policy: Rules;
  priceCents: number;
  depositCents: number;
  feeCents: number;
  /** price - deposit: paid at the salon or by invoice. */
  balanceCents: number;
  currency: Currency;
  locale: Locale;
  rescheduleCount: number;
  /** Set by a sick-day block until the booking is moved or cancelled. */
  displacedAt: number | null;
  movedFrom: number | null;
  movedBy: Actor | null;
  cancelledAt: number | null;
  cancelledBy: Actor | null;
  cancelReason: string | null;
  createdAt: number;
  service: { id: string; name: string };
  staff: { id: string; name: string; color: string | null };
  client: { id: string; firstName: string; phoneE164: string | null; email: string | null; locale: Locale } | null;
  /** The web chat token of its conversation, to reopen it. */
  conversationToken: string | null;
  payments: Payment[];
  refunds: Refund[];
  payouts: Payout[];
  money: BookingMoney;
};

export const BOOKING_COLUMNS = `id, ref, pro_id, staff_id, service_id, client_id, conversation_id, status, during, hold_expires_at,
  source, selection, policy, price_cents, deposit_cents, fee_cents, currency, locale, reschedule_count, displaced_at,
  moved_from, moved_by, cancelled_at, cancelled_by, cancel_reason, created_at,
  services (id, name),
  staff (id, name, color),
  clients (id, first_name, phone_e164, email, locale),
  conversations (token),
  payments (${PAYMENT_COLUMNS}),
  refunds (${REFUND_COLUMNS}),
  payouts (${PAYOUT_COLUMNS})`;

export type BookingRow = {
  id: string;
  ref: string;
  pro_id: string;
  staff_id: string;
  service_id: string;
  client_id: string | null;
  conversation_id: string | null;
  status: string;
  during: unknown;
  hold_expires_at: string | null;
  source: string;
  selection: unknown;
  policy: unknown;
  price_cents: number;
  deposit_cents: number;
  fee_cents: number;
  currency: string;
  locale: string;
  reschedule_count: number;
  displaced_at: string | null;
  moved_from: string | null;
  moved_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  services: Embedded<{ id: string; name: string }>;
  staff: Embedded<{ id: string; name: string; color: string | null }>;
  clients: Embedded<{ id: string; first_name: string; phone_e164: string | null; email: string | null; locale: string }>;
  conversations: Embedded<{ token: string }>;
  payments: PaymentRow[];
  refunds: RefundRow[];
  payouts: PayoutRow[];
};

const byCreated = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt;

export function toBookingDetail(row: BookingRow): BookingDetail {
  const { start, end } = parseRange(String(row.during));
  const service = one(row.services);
  const staff = one(row.staff);
  const client = one(row.clients);
  if (!service || !staff) throw new Error(`Booking ${row.id} without its service or staff member`);
  const payments = row.payments.map(toPayment).toSorted(byCreated);
  const refunds = row.refunds.map(toRefund).toSorted(byCreated);
  const payouts = row.payouts.map(toPayout).toSorted(byCreated);
  return {
    id: row.id,
    ref: row.ref,
    proId: row.pro_id,
    staffId: row.staff_id,
    serviceId: row.service_id,
    clientId: row.client_id,
    conversationId: row.conversation_id,
    status: oneOf(BOOKING_STATUSES, row.status),
    start,
    end,
    holdExpiresAt: epochOrNull(row.hold_expires_at),
    source: oneOf(BOOKING_SOURCES, row.source),
    selection: SelectionSnapshotSchema.parse(row.selection),
    policy: RulesSchema.parse(row.policy),
    priceCents: row.price_cents,
    depositCents: row.deposit_cents,
    feeCents: row.fee_cents,
    balanceCents: row.price_cents - row.deposit_cents,
    currency: oneOf(CURRENCIES, row.currency),
    locale: toLocale(row.locale),
    rescheduleCount: row.reschedule_count,
    displacedAt: epochOrNull(row.displaced_at),
    movedFrom: epochOrNull(row.moved_from),
    movedBy: oneOfOrNull(ACTORS, row.moved_by),
    cancelledAt: epochOrNull(row.cancelled_at),
    cancelledBy: oneOfOrNull(ACTORS, row.cancelled_by),
    cancelReason: row.cancel_reason,
    createdAt: Date.parse(row.created_at),
    service: { id: service.id, name: service.name },
    staff: { id: staff.id, name: staff.name, color: staff.color },
    client: client && {
      id: client.id,
      firstName: client.first_name,
      phoneE164: client.phone_e164,
      email: client.email,
      locale: toLocale(client.locale),
    },
    conversationToken: one(row.conversations)?.token ?? null,
    payments,
    refunds,
    payouts,
    money: bookingMoney(payments, refunds, payouts),
  };
}

/** A booking with its client, service, staff and money, or null. Service client (or the pro's own client). */
export async function getBooking(db: Db, id: string): Promise<BookingDetail | null> {
  const { data, error } = await db.from("bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toBookingDetail(data) : null;
}

/** The same by the 6-character reference a client reads out (any case). */
export async function getBookingByRef(db: Db, ref: string): Promise<BookingDetail | null> {
  const { data, error } = await db.from("bookings").select(BOOKING_COLUMNS).eq("ref", ref.trim().toUpperCase()).maybeSingle();
  if (error) throw error;
  return data ? toBookingDetail(data) : null;
}

/**
 * A pro's bookings overlapping [from, to), in time order, for the calendar. Expired holds are left out unless
 * `statuses` asks for them. Service client, or the pro's own client (RLS).
 */
export async function listBookings(
  db: Db,
  proId: string,
  from: number,
  to: number,
  opts: { statuses?: BookingStatus[]; staffId?: string } = {},
): Promise<BookingDetail[]> {
  let query = db.from("bookings").select(BOOKING_COLUMNS).eq("pro_id", proId).overlaps("during", formatRange(from, to));
  query = opts.statuses ? query.in("status", opts.statuses) : query.neq("status", "expired");
  if (opts.staffId) query = query.eq("staff_id", opts.staffId);
  const { data, error } = await query;
  if (error) throw error;
  return data.map(toBookingDetail).toSorted((a, b) => a.start - b.start || a.createdAt - b.createdAt);
}

/** Bookings of a conversation (newest first): what a client agent may talk about. */
export async function listConversationBookings(db: Db, conversationId: string): Promise<BookingDetail[]> {
  const { data, error } = await db.from("bookings").select(BOOKING_COLUMNS).eq("conversation_id", conversationId);
  if (error) throw error;
  return data.map(toBookingDetail).toSorted((a, b) => b.createdAt - a.createdAt);
}
