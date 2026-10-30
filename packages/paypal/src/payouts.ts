import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { centsToValue, fromMoney, isCurrency } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";

/** Payouts item transaction_status. */
export type PayoutItemStatus = "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED" | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";
/** Payouts batch_status. */
export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";

export type PayoutItemInput = {
  /** The pro's PayPal email (recipient_type EMAIL). */
  receiver: string;
  amountCents: number;
  currency: Currency;
  note: string;
  /** Our payout row id; comes back on the item and in webhooks. */
  senderItemId: string;
};

export type PayoutItem = {
  payoutItemId: string;
  payoutBatchId: string;
  senderItemId: string | null;
  status: string;
  transactionId: string | null;
  receiver: string | null;
  amountCents: number | null;
  currency: Currency | null;
  error: string | null;
};

export type PayoutBatch = {
  payoutBatchId: string;
  senderBatchId: string | null;
  status: string;
  items: PayoutItem[];
};

// Payouts money uses `currency`, not `currency_code`.
const payoutMoneySchema = z.object({ currency: z.string(), value: z.string() });

const batchHeaderSchema = z.object({
  payout_batch_id: z.string(),
  batch_status: z.string(),
  sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).optional(),
});

export const payoutItemSchema = z.object({
  payout_item_id: z.string(),
  payout_batch_id: z.string().optional(),
  transaction_id: z.string().optional(),
  transaction_status: z.string().optional(),
  sender_batch_id: z.string().optional(),
  payout_item: z
    .object({
      amount: payoutMoneySchema.optional(),
      receiver: z.string().optional(),
      sender_item_id: z.string().optional(),
    })
    .optional(),
  errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
});

const createResponseSchema = z.object({ batch_header: batchHeaderSchema });
const batchSchema = z.object({ batch_header: batchHeaderSchema, items: z.array(payoutItemSchema).optional() });

function toItem(i: z.output<typeof payoutItemSchema>, batchId: string): PayoutItem {
  const amount = fromMoney(i.payout_item?.amount);
  return {
    payoutItemId: i.payout_item_id,
    payoutBatchId: i.payout_batch_id ?? batchId,
    senderItemId: i.payout_item?.sender_item_id ?? null,
    status: i.transaction_status ?? "PENDING",
    transactionId: i.transaction_id ?? null,
    receiver: i.payout_item?.receiver ?? null,
    amountCents: amount?.cents ?? null,
    currency: amount?.currency ?? null,
    error: i.errors ? (i.errors.name ?? i.errors.message ?? "ERROR") : null,
  };
}

/** GET /v1/payments/payouts/{batch_id}: batch status and its items (first page). */
export async function getPayoutBatch(payoutBatchId: string, client: PayPalClient = defaultClient()): Promise<Result<PayoutBatch, PayPalError>> {
  const res = await client.request(
    { method: "GET", path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}` },
    batchSchema,
  );
  if (!res.ok) return res;
  const h = res.value.batch_header;
  return ok({
    payoutBatchId: h.payout_batch_id,
    senderBatchId: h.sender_batch_header?.sender_batch_id ?? null,
    status: h.batch_status,
    items: (res.value.items ?? []).map((i) => toItem(i, h.payout_batch_id)),
  });
}

/**
 * POST /v1/payments/payouts (async batch, recipient_type EMAIL). PayPal-Request-Id = senderBatchId. The create
 * response has no items, so the batch is read back once to map senderItemId → payoutItemId; when that read fails the
 * item ids are null and the PAYMENT.PAYOUTS-ITEM.* webhooks (or a later getPayoutBatch) fill them in.
 */
export async function createPayout(
  input: { senderBatchId: string; items: PayoutItemInput[]; emailSubject?: string; emailMessage?: string },
  client: PayPalClient = defaultClient(),
): Promise<Result<{ payoutBatchId: string; status: string; items: { senderItemId: string; payoutItemId: string | null; status: string }[] }, PayPalError>> {
  if (input.items.length === 0) return err(paypalError("unprocessable", "A payout needs at least one item"));
  for (const i of input.items) {
    if (!isCurrency(i.currency)) return err(paypalError("unprocessable", `Unsupported currency ${String(i.currency)}`));
    if (!Number.isSafeInteger(i.amountCents) || i.amountCents <= 0) return err(paypalError("unprocessable", "amountCents must be a positive integer"));
  }

  const body = {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      recipient_type: "EMAIL",
      email_subject: input.emailSubject ?? "Kitoko: you have a payout",
      email_message: input.emailMessage ?? "Your Kitoko booking payout has arrived.",
    },
    items: input.items.map((i) => ({
      recipient_type: "EMAIL",
      receiver: i.receiver,
      amount: { value: centsToValue(i.amountCents), currency: i.currency },
      note: i.note.slice(0, 4000),
      sender_item_id: i.senderItemId,
    })),
  };

  const res = await client.request(
    { method: "POST", path: "/v1/payments/payouts", requestId: input.senderBatchId, body },
    createResponseSchema,
  );
  if (!res.ok) return res;
  const batchId = res.value.batch_header.payout_batch_id;
  const batch = await getPayoutBatch(batchId, client);
  const bySender = new Map((batch.ok ? batch.value.items : []).map((i) => [i.senderItemId, i]));
  return ok({
    payoutBatchId: batchId,
    status: batch.ok ? batch.value.status : res.value.batch_header.batch_status,
    items: input.items.map((i) => {
      const found = bySender.get(i.senderItemId);
      return { senderItemId: i.senderItemId, payoutItemId: found?.payoutItemId ?? null, status: found?.status ?? "PENDING" };
    }),
  });
}

/** GET /v1/payments/payouts-item/{id}. */
export async function getPayoutItem(payoutItemId: string, client: PayPalClient = defaultClient()): Promise<Result<PayoutItem, PayPalError>> {
  const res = await client.request({ method: "GET", path: `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}` }, payoutItemSchema);
  return res.ok ? ok(toItem(res.value, res.value.payout_batch_id ?? "")) : res;
}
