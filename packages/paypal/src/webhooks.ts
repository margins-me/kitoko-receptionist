import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { fromMoney } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";
import { findLink, lastSegment, linkSchema, moneySchema } from "./schemas";

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const v = key === undefined ? undefined : headers[key];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

const verifySchema = z.object({ verification_status: z.string() });

/**
 * POST /v1/notifications/verify-webhook-signature with the PAYPAL-* transmission headers and the raw event body,
 * embedded verbatim (re-serializing can change the bytes PayPal signed). Ok(true) only for verification_status
 * SUCCESS; ok(false) for FAILURE, missing headers or a body that is not JSON.
 */
export async function verifyWebhook(
  input: { headers: HeaderBag; body: string; webhookId?: string },
  client: PayPalClient = defaultClient(),
): Promise<Result<boolean, PayPalError>> {
  const webhookId = input.webhookId ?? (client.config.ok ? client.config.value.webhookId : null);
  if (!webhookId) return err(paypalError("auth", "PAYPAL_WEBHOOK_ID is required to verify webhooks"));

  const h = {
    auth_algo: header(input.headers, "paypal-auth-algo"),
    cert_url: header(input.headers, "paypal-cert-url"),
    transmission_id: header(input.headers, "paypal-transmission-id"),
    transmission_sig: header(input.headers, "paypal-transmission-sig"),
    transmission_time: header(input.headers, "paypal-transmission-time"),
  };
  if (Object.values(h).some((v) => !v)) return ok(false);
  try {
    const parsed: unknown = JSON.parse(input.body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return ok(false);
  } catch {
    return ok(false);
  }

  const fields = Object.entries({ ...h, webhook_id: webhookId })
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(",");
  const res = await client.request(
    {
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      requestId: `verify-${h.transmission_id}`,
      rawBody: `{${fields},"webhook_event":${input.body}}`,
    },
    verifySchema,
  );
  return res.ok ? ok(res.value.verification_status === "SUCCESS") : res;
}

// ---- Event parsing -------------------------------------------------------------------------------------------------

export const ORDER_EVENTS = ["CHECKOUT.ORDER.APPROVED", "CHECKOUT.ORDER.COMPLETED"] as const;
/** DECLINED is the Orders v2 event; DENIED the older Payments one. Both mean the capture failed. */
export const CAPTURE_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REVERSED",
] as const;
export const PAYOUT_ITEM_EVENTS = [
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
] as const;
export const PAYOUT_BATCH_EVENTS = ["PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTSBATCH.PROCESSING"] as const;

type EventBase = {
  eventId: string;
  createTime: string | null;
  resourceType: string | null;
  summary: string | null;
};

type Amount = { amountCents: number | null; currency: Currency | null };

export type OrderEvent = EventBase &
  Amount & { kind: "order"; eventType: (typeof ORDER_EVENTS)[number]; orderId: string; customId: string | null; status: string };

export type CaptureEvent = EventBase &
  Amount & {
    kind: "capture";
    eventType: (typeof CAPTURE_EVENTS)[number];
    captureId: string;
    orderId: string | null;
    customId: string | null;
    status: string;
    /** status_details.reason (PENDING_REVIEW…). */
    reason: string | null;
  };

export type RefundEvent = EventBase &
  Amount & {
    kind: "refund";
    eventType: "PAYMENT.CAPTURE.REFUNDED";
    refundId: string;
    captureId: string | null;
    customId: string | null;
    status: string;
  };

export type PayoutItemEvent = EventBase &
  Amount & {
    kind: "payout_item";
    eventType: (typeof PAYOUT_ITEM_EVENTS)[number];
    payoutItemId: string;
    payoutBatchId: string | null;
    senderItemId: string | null;
    status: string;
    transactionId: string | null;
    error: string | null;
  };

export type PayoutBatchEvent = EventBase &
  Amount & {
    kind: "payout_batch";
    eventType: (typeof PAYOUT_BATCH_EVENTS)[number];
    payoutBatchId: string;
    senderBatchId: string | null;
    status: string;
  };

export type InvoicePaidEvent = EventBase &
  Amount & { kind: "invoice_paid"; eventType: "INVOICING.INVOICE.PAID"; invoiceId: string; reference: string | null; status: string };

/** Any other event type: stored and acknowledged, not acted on. */
export type OtherEvent = EventBase & { kind: "other"; eventType: string; resourceId: string | null };

export type PayPalEvent = OrderEvent | CaptureEvent | RefundEvent | PayoutItemEvent | PayoutBatchEvent | InvoicePaidEvent | OtherEvent;

export type ParseEventError = "invalid_json" | "invalid_event";

const envelopeSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  create_time: z.string().optional(),
  resource_type: z.string().optional(),
  summary: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
});

const orderResource = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z.array(z.object({ custom_id: z.string().optional(), amount: moneySchema.optional() })).optional(),
});

const captureResource = z.object({
  id: z.string(),
  status: z.string(),
  amount: moneySchema.optional(),
  custom_id: z.string().optional(),
  status_details: z.object({ reason: z.string().optional() }).optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
  links: z.array(linkSchema).optional(),
});

const refundResource = z.object({
  id: z.string(),
  status: z.string(),
  amount: moneySchema.optional(),
  custom_id: z.string().optional(),
  links: z.array(linkSchema).optional(),
});

const payoutItemResource = z.object({
  payout_item_id: z.string(),
  payout_batch_id: z.string().optional(),
  transaction_id: z.string().optional(),
  transaction_status: z.string().optional(),
  payout_item: z
    .object({
      amount: z.object({ currency: z.string(), value: z.string() }).optional(),
      sender_item_id: z.string().optional(),
    })
    .optional(),
  errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
});

const payoutBatchResource = z.object({
  batch_header: z.object({
    payout_batch_id: z.string(),
    batch_status: z.string(),
    sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).optional(),
    amount: z.object({ currency: z.string(), value: z.string() }).optional(),
  }),
});

const invoiceObject = z.object({
  id: z.string(),
  status: z.string(),
  detail: z.object({ reference: z.string().optional() }).optional(),
  amount: moneySchema.optional(),
});
// Invoicing v2 events wrap the invoice in resource.invoice; the docs sample puts it at resource. Accept both.
const invoiceResource = z.union([z.object({ invoice: invoiceObject }).transform((r) => r.invoice), invoiceObject]);

const includes = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

const amountOf = (m: Parameters<typeof fromMoney>[0]): Amount => {
  const a = fromMoney(m);
  return { amountCents: a?.cents ?? null, currency: a?.currency ?? null };
};

/** A webhook body (raw string or parsed JSON) → the event Kitoko acts on. Unknown event types come back as `other`. */
export function parseEvent(body: string | unknown): Result<PayPalEvent, ParseEventError> {
  let json: unknown = body;
  if (typeof body === "string") {
    try {
      json = JSON.parse(body);
    } catch {
      return err("invalid_json");
    }
  }
  const env = envelopeSchema.safeParse(json);
  if (!env.success) return err("invalid_event");
  const e = env.data;
  const base: EventBase = {
    eventId: e.id,
    createTime: e.create_time ?? null,
    resourceType: e.resource_type ?? null,
    summary: e.summary ?? null,
  };
  const type = e.event_type;

  if (includes(ORDER_EVENTS, type)) {
    const r = orderResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    const unit = r.data.purchase_units?.[0];
    return ok({ ...base, ...amountOf(unit?.amount), kind: "order", eventType: type, orderId: r.data.id, customId: unit?.custom_id ?? null, status: r.data.status });
  }

  if (includes(CAPTURE_EVENTS, type)) {
    const r = captureResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    const c = r.data;
    return ok({
      ...base,
      ...amountOf(c.amount),
      kind: "capture",
      eventType: type,
      captureId: c.id,
      orderId: c.supplementary_data?.related_ids?.order_id ?? lastSegment(findLink(c.links, "up")),
      customId: c.custom_id ?? null,
      status: c.status,
      reason: c.status_details?.reason ?? null,
    });
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    const r = refundResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    return ok({
      ...base,
      ...amountOf(r.data.amount),
      kind: "refund",
      eventType: type,
      refundId: r.data.id,
      captureId: lastSegment(findLink(r.data.links, "up")),
      customId: r.data.custom_id ?? null,
      status: r.data.status,
    });
  }

  if (includes(PAYOUT_ITEM_EVENTS, type)) {
    const r = payoutItemResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    const i = r.data;
    return ok({
      ...base,
      ...amountOf(i.payout_item?.amount),
      kind: "payout_item",
      eventType: type,
      payoutItemId: i.payout_item_id,
      payoutBatchId: i.payout_batch_id ?? null,
      senderItemId: i.payout_item?.sender_item_id ?? null,
      status: i.transaction_status ?? type.slice("PAYMENT.PAYOUTS-ITEM.".length),
      transactionId: i.transaction_id ?? null,
      error: i.errors ? (i.errors.name ?? i.errors.message ?? "ERROR") : null,
    });
  }

  if (includes(PAYOUT_BATCH_EVENTS, type)) {
    const r = payoutBatchResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    const h = r.data.batch_header;
    return ok({
      ...base,
      ...amountOf(h.amount),
      kind: "payout_batch",
      eventType: type,
      payoutBatchId: h.payout_batch_id,
      senderBatchId: h.sender_batch_header?.sender_batch_id ?? null,
      status: h.batch_status,
    });
  }

  if (type === "INVOICING.INVOICE.PAID") {
    const r = invoiceResource.safeParse(e.resource);
    if (!r.success) return err("invalid_event");
    return ok({
      ...base,
      ...amountOf(r.data.amount),
      kind: "invoice_paid",
      eventType: type,
      invoiceId: r.data.id,
      reference: r.data.detail?.reference ?? null,
      status: r.data.status,
    });
  }

  const id = e.resource.id;
  return ok({ ...base, kind: "other", eventType: type, resourceId: typeof id === "string" ? id : null });
}
