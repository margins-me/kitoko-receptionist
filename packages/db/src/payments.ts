import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import type { Db } from "./clients";
import { dbError } from "./errors";
import {
  CAPTURE_OUTCOMES,
  CURRENCIES,
  one,
  oneOf,
  PAYMENT_COLUMNS,
  PAYOUT_COLUMNS,
  REFUND_COLUMNS,
  toPayment,
  toPayout,
  toRefund,
} from "./rows";
import type { CaptureOutcome, Currency, Embedded, Payment, Payout, PayoutStatus, Refund } from "./rows";
import type { Json } from "./types.gen";
import { parseRange } from "./range";

// All of these use the service client, except the pro's own reads through RLS (listProMoney).

/** Records the PayPal order created for a held booking's deposit; amounts come from the booking row. Idempotent. */
export async function paypalPrepare(
  db: Db,
  bookingId: string,
  orderId: string,
): Promise<Result<{ paymentId: string }, "not_found" | "not_payable" | "invalid_argument">> {
  const { data, error } = await db.rpc("paypal_prepare", { p_booking_id: bookingId, p_order_id: orderId });
  if (error) return err(dbError(error, ["P0002", "KT011", "22023"]));
  return ok({ paymentId: data });
}

export type CaptureInput = {
  orderId: string;
  captureId: string;
  /** What PayPal says it captured, in cents: checked against the payment. */
  amountCents: number;
  currency: string;
  /** PayPal's payer object (name.given_name, email_address). */
  payer?: Json;
};

/**
 * PAYMENT.CAPTURE.COMPLETED, or the capture on return from PayPal. Idempotent. Confirms the booking, or queues a full
 * refund when the slot went meanwhile (slot_lost) or the booking was already paid (duplicate).
 */
export async function paypalCaptureCompleted(
  db: Db,
  input: CaptureInput,
): Promise<Result<{ paymentId: string; bookingId: string; outcome: CaptureOutcome }, "not_found" | "amount_mismatch">> {
  const { data, error } = await db.rpc("paypal_capture_completed", {
    p_order_id: input.orderId,
    p_capture_id: input.captureId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_payer: input.payer,
  });
  if (error) return err(dbError(error, ["P0002", "KT031"]));
  const row = data[0];
  if (!row) throw new Error("paypal_capture_completed returned no row");
  return ok({ paymentId: row.payment_id, bookingId: row.booking_id, outcome: oneOf(CAPTURE_OUTCOMES, row.outcome) });
}

/** PAYMENT.CAPTURE.DENIED: the payment is denied and its hold lets go of the slot. */
export async function paypalCaptureDenied(db: Db, orderId: string): Promise<Result<void, "not_found">> {
  const { error } = await db.rpc("paypal_capture_denied", { p_order_id: orderId });
  if (error) return err(dbError(error, ["P0002"]));
  return ok(undefined);
}

/**
 * A declined capture (422 INSTRUMENT_DECLINED): the booking stays held and the buyer approves again. Returns how many
 * captures of this order were declined (the next capture's PayPal-Request-Id counts them), null when the payment is no
 * longer waiting for a capture.
 */
export async function paypalCaptureDeclined(db: Db, orderId: string): Promise<Result<number | null, "not_found">> {
  const { data, error } = await db.rpc("paypal_capture_declined", { p_order_id: orderId });
  if (error) return err(dbError(error, ["P0002"]));
  return ok(data ?? null);
}

/** A refund the pro confirmed (pending action) on a captured payment. */
export async function requestRefund(
  db: Db,
  input: { paymentId: string; amountCents: number; reason?: string },
): Promise<Result<{ refundId: string }, "not_found" | "not_refundable" | "exceeds_balance">> {
  const { data, error } = await db.rpc("request_refund", {
    p_payment_id: input.paymentId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason,
  });
  if (error) return err(dbError(error, ["P0002", "KT033", "KT012"]));
  return ok({ refundId: data });
}

/** The PayPal refund call finished. Idempotent for the same status. */
export async function refundFinished(
  db: Db,
  input: { refundId: string; paypalRefundId?: string | null; status: "succeeded" | "failed" },
): Promise<Result<void, "not_found" | "not_pending">> {
  const { error } = await db.rpc("refund_finished", {
    p_refund_id: input.refundId,
    p_paypal_refund_id: input.paypalRefundId ?? undefined,
    p_status: input.status,
  });
  if (error) return err(dbError(error, ["P0002", "KT032"]));
  return ok(undefined);
}

/** A payout went out in a Payouts batch. */
export async function payoutSent(
  db: Db,
  input: { payoutId: string; batchId: string; itemId: string },
): Promise<Result<void, "not_found">> {
  const { error } = await db.rpc("payout_sent", {
    p_payout_id: input.payoutId,
    p_batch_id: input.batchId,
    p_item_id: input.itemId,
  });
  if (error) return err(dbError(error, ["P0002"]));
  return ok(undefined);
}

/** PAYMENT.PAYOUTS-ITEM.* by payout item id. */
export async function payoutStatus(
  db: Db,
  input: { itemId: string; status: PayoutStatus },
): Promise<Result<void, "not_found">> {
  const { error } = await db.rpc("payout_status", { p_item_id: input.itemId, p_status: input.status });
  if (error) return err(dbError(error, ["P0002"]));
  return ok(undefined);
}

/** Stores a webhook event once. False when it was already seen (PayPal retries): skip it. */
export async function recordPaypalEvent(
  db: Db,
  input: { eventId: string; type: string; resourceId?: string | null; payload: Json; verified: boolean },
): Promise<boolean> {
  const { data, error } = await db.rpc("record_paypal_event", {
    p_event_id: input.eventId,
    p_type: input.type,
    p_resource_id: input.resourceId ?? undefined,
    p_payload: input.payload,
    p_verified: input.verified,
  });
  if (error) throw error;
  return data;
}

export async function markPaypalEventProcessed(db: Db, eventId: string): Promise<void> {
  await db.from("paypal_events").update({ processed_at: new Date().toISOString() }).eq("event_id", eventId).throwOnError();
}

export async function getPaymentByOrderId(db: Db, orderId: string): Promise<Payment | null> {
  const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).eq("paypal_order_id", orderId).maybeSingle();
  if (error) throw error;
  return data ? toPayment(data) : null;
}

export async function getPaymentByCaptureId(db: Db, captureId: string): Promise<Payment | null> {
  const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).eq("capture_id", captureId).maybeSingle();
  if (error) throw error;
  return data ? toPayment(data) : null;
}

/** A booking's deposit payment: the captured one, else the latest order. Null without any. */
export async function getDepositPayment(db: Db, bookingId: string): Promise<Payment | null> {
  const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).eq("booking_id", bookingId).eq("kind", "deposit");
  if (error) throw error;
  const payments = data.map(toPayment);
  const captured = payments.filter((p) => p.status === "captured" || p.status === "refunded").sort((a, b) => a.createdAt - b.createdAt);
  return captured[0] ?? payments.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** A refund to send to PayPal (POST /v2/payments/captures/{captureId}/refund). */
export type RefundJob = Refund & { captureId: string | null };

/** Pending refunds, oldest first. A SEED- capture id is never sent to PayPal. */
export async function listPendingRefunds(db: Db, opts: { limit?: number; bookingId?: string } = {}): Promise<RefundJob[]> {
  let query = db.from("refunds").select(`${REFUND_COLUMNS}, payments (capture_id)`).eq("status", "pending");
  if (opts.bookingId) query = query.eq("booking_id", opts.bookingId);
  const { data, error } = await query.order("created_at").limit(opts.limit ?? 50);
  if (error) throw error;
  return data.map((row) => ({
    ...toRefund(row),
    captureId: one(row.payments as Embedded<{ capture_id: string | null }>)?.capture_id ?? null,
  }));
}

/** A payout to send with the Payouts API, to the pro's PayPal e-mail. */
export type PayoutJob = Payout & { paypalEmail: string | null };

/** Pending payouts, oldest first. */
export async function listPendingPayouts(db: Db, opts: { limit?: number; bookingId?: string } = {}): Promise<PayoutJob[]> {
  let query = db.from("payouts").select(`${PAYOUT_COLUMNS}, pros (paypal_email)`).eq("status", "pending");
  if (opts.bookingId) query = query.eq("booking_id", opts.bookingId);
  const { data, error } = await query.order("created_at").limit(opts.limit ?? 50);
  if (error) throw error;
  return data.map((row) => ({
    ...toPayout(row),
    paypalEmail: one(row.pros as Embedded<{ paypal_email: string | null }>)?.paypal_email ?? null,
  }));
}

export type ProMoney = { currency: Currency; payments: Payment[]; refunds: Refund[]; payouts: Payout[] };

/** Bookings per request in the money reads (keeps the `in (...)` filter's URL short). */
const ID_CHUNK = 150;

/**
 * A pro's payments, refunds and payouts for the bookings whose APPOINTMENT starts in [from, to) (all of them when
 * both are omitted): her earnings from our own rows. "This week" means this week's appointments, whenever their
 * deposit was captured (seeded payments and early bookings were captured days before). Service client, or the pro's
 * own client.
 */
export async function listProMoney(db: Db, proId: string, range: { from?: number; to?: number } = {}): Promise<ProMoney> {
  const pro = await db.from("pros").select("currency").eq("id", proId).single().throwOnError();
  const currency = oneOf(CURRENCIES, pro.data.currency);
  let ids: string[] | null = null;
  if (range.from !== undefined || range.to !== undefined) {
    const from = range.from ?? -8.64e15;
    const to = range.to ?? 8.64e15;
    // Overlap narrows the rows in SQL; the start test below keeps a booking that crosses `from` out of this range.
    const { data } = await db
      .from("bookings")
      .select("id, during")
      .eq("pro_id", proId)
      .overlaps("during", `[${range.from === undefined ? "-infinity" : new Date(from).toISOString()},${range.to === undefined ? "infinity" : new Date(to).toISOString()})`)
      .throwOnError();
    ids = data.filter((b) => {
      const start = parseRange(b.during as string).start;
      return start >= from && start < to;
    }).map((b) => b.id);
    if (ids.length === 0) return { currency, payments: [], refunds: [], payouts: [] };
  }
  const read = async <R, T>(table: "payments" | "refunds" | "payouts", columns: string, map: (row: R) => T): Promise<T[]> => {
    const chunks = ids === null ? [null] : Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, k) => ids!.slice(k * ID_CHUNK, (k + 1) * ID_CHUNK));
    const out: T[] = [];
    for (const chunk of chunks) {
      let query = db.from(table).select(columns).eq("pro_id", proId);
      if (chunk) query = query.in("booking_id", chunk);
      const { data, error } = await query.order("created_at");
      if (error) throw error;
      out.push(...(data as unknown as R[]).map(map));
    }
    return out;
  };
  const [payments, refunds, payouts] = await Promise.all([
    read("payments", PAYMENT_COLUMNS, toPayment),
    read("refunds", REFUND_COLUMNS, toRefund),
    read("payouts", PAYOUT_COLUMNS, toPayout),
  ]);
  return { currency, payments, refunds, payouts };
}
