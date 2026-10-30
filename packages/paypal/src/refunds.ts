import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { fromMoney, isCurrency, money } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";
import { findLink, lastSegment, linkSchema, moneySchema } from "./schemas";

export type RefundStatus = "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";

export type Refund = {
  refundId: string;
  status: string;
  amountCents: number;
  currency: Currency;
  /** The refunded capture (from the `up` link), when PayPal includes it. */
  captureId: string | null;
  /** True for a seeded capture: nothing was sent to PayPal. */
  synthetic: boolean;
};

/** Seed rows use capture ids starting with this prefix; they never reach PayPal. */
export const SEED_PREFIX = "SEED-";

const refundSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: moneySchema.optional(),
  links: z.array(linkSchema).optional(),
});

function toRefund(r: z.output<typeof refundSchema>, fallback: { cents: number; currency: Currency } | null): Result<Refund, PayPalError> {
  const amount = fromMoney(r.amount) ?? fallback;
  if (!amount) return err(paypalError("unknown", `Refund ${r.id} has no readable amount`, { issue: "UNEXPECTED_RESPONSE" }));
  return ok({
    refundId: r.id,
    status: r.status,
    amountCents: amount.cents,
    currency: amount.currency,
    captureId: lastSegment(findLink(r.links, "up")),
    synthetic: false,
  });
}

/**
 * POST /v2/payments/captures/{id}/refund for a partial (or full) amount. The reason goes to the client as
 * note_to_payer. A capture id starting with SEED- returns a synthetic COMPLETED refund without any HTTP call.
 */
export async function refundCapture(
  input: { captureId: string; amountCents: number; currency: Currency; reason: string; requestId: string; invoiceId?: string },
  client: PayPalClient = defaultClient(),
): Promise<Result<Refund, PayPalError>> {
  if (!isCurrency(input.currency)) return err(paypalError("unprocessable", `Unsupported currency ${String(input.currency)}`));
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return err(paypalError("unprocessable", "amountCents must be a positive integer"));
  }
  if (input.captureId.startsWith(SEED_PREFIX)) {
    return ok({
      refundId: `SEED-R-${input.requestId}`,
      status: "COMPLETED",
      amountCents: input.amountCents,
      currency: input.currency,
      captureId: input.captureId,
      synthetic: true,
    });
  }

  const body: Record<string, unknown> = {
    amount: money(input.amountCents, input.currency),
    note_to_payer: input.reason.slice(0, 255),
  };
  if (input.invoiceId) body.invoice_id = input.invoiceId.slice(0, 127);

  const res = await client.request(
    {
      method: "POST",
      path: `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
      requestId: input.requestId,
      prefer: "return=representation",
      body,
    },
    refundSchema,
  );
  if (!res.ok) return res;
  const r = toRefund(res.value, { cents: input.amountCents, currency: input.currency });
  return r.ok ? ok({ ...r.value, captureId: r.value.captureId ?? input.captureId }) : r;
}

/** GET /v2/payments/refunds/{id}. */
export async function getRefund(refundId: string, client: PayPalClient = defaultClient()): Promise<Result<Refund, PayPalError>> {
  if (refundId.startsWith(SEED_PREFIX)) return err(paypalError("not_found", `Seeded refund ${refundId} is not on PayPal`));
  const res = await client.request({ method: "GET", path: `/v2/payments/refunds/${encodeURIComponent(refundId)}` }, refundSchema);
  return res.ok ? toRefund(res.value, null) : res;
}
