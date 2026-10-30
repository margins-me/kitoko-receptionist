import type { Json } from "./types.gen";

// Text values guarded by CHECK constraints in supabase/migrations.
export const BOOKING_STATUSES = ["held", "confirmed", "honoured", "no_show", "cancelled", "expired"] as const;
export const BOOKING_SOURCES = ["web", "whatsapp", "mcp", "manual"] as const;
/** cancelled_by, moved_by, and who asks for a cancellation or a move. */
export const ACTORS = ["client", "pro", "system"] as const;
export const CURRENCIES = ["EUR", "GBP"] as const;
export const PAYMENT_KINDS = ["deposit", "balance"] as const;
export const PAYMENT_STATUSES = ["created", "approved", "captured", "refunded", "denied"] as const;
export const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;
export const PAYOUT_STATUSES = ["pending", "sent", "succeeded", "failed", "unclaimed"] as const;
export const PAYOUT_REASONS = ["honoured", "no_show", "late_cancel"] as const;
export const CONVERSATION_KINDS = ["client", "pro"] as const;
export const CHANNELS = ["web", "whatsapp", "mcp"] as const;
export const MESSAGE_ROLES = ["user", "assistant"] as const;
export const AGENT_EVENT_KINDS = ["tool", "model", "paypal", "error", "system"] as const;
export const PENDING_ACTION_KINDS = ["refund", "payout", "invoice"] as const;
export const PENDING_ACTION_STATUSES = ["pending", "confirmed", "cancelled"] as const;
/** What paypal_capture_completed did with a capture. */
export const CAPTURE_OUTCOMES = ["confirmed", "already_captured", "slot_lost", "duplicate"] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export type Actor = (typeof ACTORS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export type PayoutReason = (typeof PAYOUT_REASONS)[number];
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
export type Channel = (typeof CHANNELS)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];
export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];
export type PendingActionStatus = (typeof PENDING_ACTION_STATUSES)[number];
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

export function oneOf<T extends string>(values: readonly T[], value: string): T {
  const found = values.find((v) => v === value);
  if (found === undefined) throw new Error(`Unexpected value "${value}", expected one of ${values.join(", ")}`);
  return found;
}

export const oneOfOrNull = <T extends string>(values: readonly T[], value: string | null): T | null =>
  value === null ? null : oneOf(values, value);

export type Embedded<T> = T | T[] | null;
// PostgREST embeds a many-to-one relation as an object, older versions as an array.
export const one = <T>(embed: Embedded<T>): T | null => (Array.isArray(embed) ? (embed[0] ?? null) : embed);

export const epochOrNull = (timestamp: string | null): number | null => (timestamp === null ? null : Date.parse(timestamp));

/** Seeded captures (supabase/seed.sql) carry SEED- ids: never send them to PayPal. */
export const isSeedCapture = (captureId: string | null): boolean => captureId?.startsWith("SEED-") === true;

// payments

export type Payment = {
  id: string;
  proId: string;
  bookingId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  paypalOrderId: string;
  captureId: string | null;
  depositCents: number;
  feeCents: number;
  amountCents: number;
  /** Includes refunds still being processed. */
  refundedCents: number;
  currency: Currency;
  payer: Json | null;
  capturedAt: number | null;
  createdAt: number;
};

export const PAYMENT_COLUMNS =
  "id, pro_id, booking_id, kind, status, paypal_order_id, capture_id, deposit_cents, fee_cents, amount_cents, refunded_cents, currency, payer, captured_at, created_at";

export type PaymentRow = {
  id: string;
  pro_id: string;
  booking_id: string;
  kind: string;
  status: string;
  paypal_order_id: string;
  capture_id: string | null;
  deposit_cents: number;
  fee_cents: number;
  amount_cents: number;
  refunded_cents: number;
  currency: string;
  payer: Json | null;
  captured_at: string | null;
  created_at: string;
};

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    proId: row.pro_id,
    bookingId: row.booking_id,
    kind: oneOf(PAYMENT_KINDS, row.kind),
    status: oneOf(PAYMENT_STATUSES, row.status),
    paypalOrderId: row.paypal_order_id,
    captureId: row.capture_id,
    depositCents: row.deposit_cents,
    feeCents: row.fee_cents,
    amountCents: row.amount_cents,
    refundedCents: row.refunded_cents,
    currency: oneOf(CURRENCIES, row.currency),
    payer: row.payer,
    capturedAt: epochOrNull(row.captured_at),
    createdAt: Date.parse(row.created_at),
  };
}

// refunds

export type Refund = {
  id: string;
  proId: string;
  paymentId: string;
  bookingId: string;
  amountCents: number;
  currency: Currency;
  /** client_cancel, pro_cancel, system_cancel, slot_lost, duplicate, pro_request, or the reason given */
  reason: string;
  status: RefundStatus;
  paypalRefundId: string | null;
  createdAt: number;
};

export const REFUND_COLUMNS = "id, pro_id, payment_id, booking_id, amount_cents, currency, reason, status, paypal_refund_id, created_at";

export type RefundRow = {
  id: string;
  pro_id: string;
  payment_id: string;
  booking_id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
  paypal_refund_id: string | null;
  created_at: string;
};

export function toRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    proId: row.pro_id,
    paymentId: row.payment_id,
    bookingId: row.booking_id,
    amountCents: row.amount_cents,
    currency: oneOf(CURRENCIES, row.currency),
    reason: row.reason,
    status: oneOf(REFUND_STATUSES, row.status),
    paypalRefundId: row.paypal_refund_id,
    createdAt: Date.parse(row.created_at),
  };
}

// payouts

export type Payout = {
  id: string;
  proId: string;
  bookingId: string;
  /** The deposit kept for the pro (never the booking fee). */
  amountCents: number;
  /** The booking fee Kitoko kept on this booking, for display. */
  feeCents: number;
  currency: Currency;
  reason: PayoutReason;
  status: PayoutStatus;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  createdAt: number;
};

export const PAYOUT_COLUMNS =
  "id, pro_id, booking_id, amount_cents, fee_cents, currency, reason, status, payout_batch_id, payout_item_id, created_at";

export type PayoutRow = {
  id: string;
  pro_id: string;
  booking_id: string;
  amount_cents: number;
  fee_cents: number;
  currency: string;
  reason: string;
  status: string;
  payout_batch_id: string | null;
  payout_item_id: string | null;
  created_at: string;
};

export function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    proId: row.pro_id,
    bookingId: row.booking_id,
    amountCents: row.amount_cents,
    feeCents: row.fee_cents,
    currency: oneOf(CURRENCIES, row.currency),
    reason: oneOf(PAYOUT_REASONS, row.reason),
    status: oneOf(PAYOUT_STATUSES, row.status),
    payoutBatchId: row.payout_batch_id,
    payoutItemId: row.payout_item_id,
    createdAt: Date.parse(row.created_at),
  };
}

/** A booking's money at a glance (calendar, booking sheet). */
export type BookingMoney = {
  /** Captured: deposit + booking fee. 0 when nothing was paid. */
  paidCents: number;
  /** Refunded or being refunded. */
  refundedCents: number;
  refundPending: boolean;
  /** Queued or paid out to the pro; null when no payout. */
  payoutCents: number | null;
  payoutStatus: PayoutStatus | null;
  /** The capture of the deposit, for PayPal refunds (null before capture). */
  captureId: string | null;
};

export function bookingMoney(payments: Payment[], refunds: Refund[], payouts: Payout[]): BookingMoney {
  const captured = payments.filter((p) => p.status === "captured" || p.status === "refunded");
  const payout = payouts[0] ?? null;
  return {
    paidCents: captured.reduce((sum, p) => sum + p.amountCents, 0),
    refundedCents: refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amountCents, 0),
    refundPending: refunds.some((r) => r.status === "pending"),
    payoutCents: payout?.amountCents ?? null,
    payoutStatus: payout?.status ?? null,
    captureId: captured.find((p) => p.kind === "deposit")?.captureId ?? null,
  };
}
