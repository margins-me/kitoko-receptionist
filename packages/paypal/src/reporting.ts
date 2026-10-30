import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { fromMoney } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";
import { moneySchema } from "./schemas";

/** One row of GET /v1/reporting/transactions. Amounts are signed cents (refunds and payouts are negative). */
export type TransactionRow = {
  transactionId: string;
  /** T0006 checkout payment, T1107 refund, T0000/T0001 payout… */
  eventCode: string | null;
  /** S success, P pending, D denied, V reversed. */
  status: string | null;
  initiatedAt: string | null;
  updatedAt: string | null;
  amountCents: number | null;
  feeCents: number | null;
  currency: Currency | null;
  /** custom_field: our booking id on checkout payments. */
  customId: string | null;
  invoiceId: string | null;
  /** The related transaction (the capture a refund reverses). */
  referenceId: string | null;
  payerEmail: string | null;
  payerName: string | null;
};

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;

const pageSchema = z.object({
  transaction_details: z
    .array(
      z.object({
        transaction_info: z.object({
          transaction_id: z.string(),
          transaction_event_code: z.string().optional(),
          transaction_status: z.string().optional(),
          transaction_initiation_date: z.string().optional(),
          transaction_updated_date: z.string().optional(),
          transaction_amount: moneySchema.optional(),
          fee_amount: moneySchema.optional(),
          custom_field: z.string().optional(),
          invoice_id: z.string().optional(),
          paypal_reference_id: z.string().optional(),
        }),
        payer_info: z
          .object({
            email_address: z.string().optional(),
            payer_name: z.object({ alternate_full_name: z.string().optional(), given_name: z.string().optional(), surname: z.string().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  page: z.number().optional(),
  total_pages: z.number().optional(),
  last_refreshed_datetime: z.string().optional(),
});

// PayPal wants seconds and an offset: 2026-10-27T10:00:00Z (fractional seconds optional).
const isoSeconds = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

/**
 * GET /v1/reporting/transactions for [start, end] (≤ 31 days), fields=all, all pages (max 10 × 500 rows). Transactions
 * take up to 3 hours to appear (longer in sandbox): `lastRefreshed` says how fresh the data is.
 */
export async function listTransactions(
  input: { start: Date | string; end: Date | string },
  client: PayPalClient = defaultClient(),
): Promise<Result<{ rows: TransactionRow[]; lastRefreshed: string | null }, PayPalError>> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return err(paypalError("unprocessable", "start and end must be valid dates with start ≤ end"));
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_MS) return err(paypalError("unprocessable", "PayPal Reporting covers at most 31 days per call"));

  const rows: TransactionRow[] = [];
  let lastRefreshed: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.request(
      {
        method: "GET",
        path: "/v1/reporting/transactions",
        query: { start_date: isoSeconds(start), end_date: isoSeconds(end), fields: "all", page_size: 500, page },
      },
      pageSchema,
    );
    if (!res.ok) return res;
    lastRefreshed = res.value.last_refreshed_datetime ?? lastRefreshed;
    for (const d of res.value.transaction_details ?? []) {
      const t = d.transaction_info;
      const amount = fromMoney(t.transaction_amount);
      const fee = fromMoney(t.fee_amount);
      const n = d.payer_info?.payer_name;
      const name = n?.alternate_full_name ?? [n?.given_name, n?.surname].filter(Boolean).join(" ");
      rows.push({
        transactionId: t.transaction_id,
        eventCode: t.transaction_event_code ?? null,
        status: t.transaction_status ?? null,
        initiatedAt: t.transaction_initiation_date ?? null,
        updatedAt: t.transaction_updated_date ?? null,
        amountCents: amount?.cents ?? null,
        feeCents: fee?.cents ?? null,
        currency: amount?.currency ?? null,
        customId: t.custom_field ?? null,
        invoiceId: t.invoice_id ?? null,
        referenceId: t.paypal_reference_id ?? null,
        payerEmail: d.payer_info?.email_address ?? null,
        payerName: name || null,
      });
    }
    if (page >= (res.value.total_pages ?? 1)) break;
  }
  return ok({ rows, lastRefreshed });
}
