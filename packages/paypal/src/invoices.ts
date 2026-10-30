import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { isCurrency, money } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";
import { findLink, lastSegment, linkSchema } from "./schemas";

export type InvoiceInput = {
  /** Must be the API caller's PayPal account email. Omitted → PayPal uses the caller's account. */
  invoicerEmail?: string;
  /** The business shown as the sender (the pro, e.g. "Aïcha Braids · via Kitoko"). Omitted → the account's name. */
  invoicerBusinessName?: string;
  recipientEmail: string;
  recipientName: string;
  items: { name: string; amountCents: number }[];
  currency: Currency;
  note: string;
  /** Shown on the invoice (detail.reference, ≤ 120 chars): the booking ref. */
  reference: string;
  /** Stable key (our pending action id). The send call uses `{requestId}-send`. */
  requestId: string;
};

export type SentInvoice = { invoiceId: string; status: string; payerViewUrl: string | null };

const invoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  detail: z.object({ metadata: z.object({ recipient_view_url: z.string().optional() }).optional() }).optional(),
});

// Create answers the full invoice with Prefer: return=representation, else a bare link to it.
const createSchema = z.union([invoiceSchema, linkSchema.transform((l) => ({ id: lastSegment(l.href) ?? "", status: "DRAFT", detail: undefined }))]);

// Send answers a bare payer-view link (200) or { links: [...] } (202).
const sendSchema = z.union([
  linkSchema.transform((l) => [l]),
  z.object({ links: z.array(linkSchema).optional() }).transform((b) => b.links ?? []),
]);

function splitName(full: string): { given_name: string; surname?: string } {
  const parts = full.trim().split(/\s+/);
  const given = (parts.shift() ?? "").slice(0, 140);
  const surname = parts.join(" ").slice(0, 140);
  return surname ? { given_name: given, surname } : { given_name: given };
}

/** GET /v2/invoicing/invoices/{id}. */
export async function getInvoice(invoiceId: string, client: PayPalClient = defaultClient()): Promise<Result<SentInvoice, PayPalError>> {
  const res = await client.request({ method: "GET", path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}` }, invoiceSchema);
  if (!res.ok) return res;
  return ok({ invoiceId: res.value.id, status: res.value.status, payerViewUrl: res.value.detail?.metadata?.recipient_view_url ?? null });
}

/**
 * Draft (POST /v2/invoicing/invoices, due on receipt, no tip, no partial payment) then send
 * (POST /v2/invoicing/invoices/{id}/send). Returns the payer-view URL the client pays at. Both POSTs are idempotent
 * on `requestId`, so a retry after a failed send reuses the same draft.
 */
export async function createAndSendInvoice(input: InvoiceInput, client: PayPalClient = defaultClient()): Promise<Result<SentInvoice, PayPalError>> {
  if (!isCurrency(input.currency)) return err(paypalError("unprocessable", `Unsupported currency ${String(input.currency)}`));
  if (input.items.length === 0) return err(paypalError("unprocessable", "An invoice needs at least one item"));
  if (input.items.some((i) => !Number.isSafeInteger(i.amountCents) || i.amountCents <= 0)) {
    return err(paypalError("unprocessable", "Item amounts must be positive integers"));
  }

  const body = {
    detail: {
      currency_code: input.currency,
      reference: input.reference.slice(0, 120),
      note: input.note.slice(0, 4000),
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    ...(input.invoicerEmail || input.invoicerBusinessName
      ? {
          invoicer: {
            ...(input.invoicerEmail ? { email_address: input.invoicerEmail } : {}),
            ...(input.invoicerBusinessName ? { business_name: input.invoicerBusinessName.slice(0, 300) } : {}),
          },
        }
      : {}),
    primary_recipients: [{ billing_info: { name: splitName(input.recipientName), email_address: input.recipientEmail } }],
    items: input.items.map((i) => ({
      name: i.name.slice(0, 200),
      quantity: "1",
      unit_amount: money(i.amountCents, input.currency),
      unit_of_measure: "AMOUNT",
    })),
    configuration: {
      allow_tip: false,
      partial_payment: { allow_partial_payment: false },
      tax_calculated_after_discount: true,
    },
  };

  const created = await client.request(
    { method: "POST", path: "/v2/invoicing/invoices", requestId: input.requestId, prefer: "return=representation", body },
    createSchema,
  );
  if (!created.ok) return created;
  const invoiceId = created.value.id;
  if (!invoiceId) return err(paypalError("unknown", "Invoice created without an id", { issue: "UNEXPECTED_RESPONSE" }));

  const sent = await client.request(
    {
      method: "POST",
      path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
      requestId: `${input.requestId}-send`,
      body: { send_to_recipient: true, send_to_invoicer: false },
    },
    sendSchema,
  );
  if (!sent.ok) return sent;

  const after = await getInvoice(invoiceId, client);
  const payerViewUrl = findLink(sent.value, "payer-view") ?? (after.ok ? after.value.payerViewUrl : null);
  return ok({ invoiceId, status: after.ok ? after.value.status : "SENT", payerViewUrl });
}
