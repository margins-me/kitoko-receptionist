import "server-only";
import { z } from "zod";
import { defaultClient, paypalError } from "./client";
import type { PayPalClient, PayPalError } from "./client";
import { fromMoney, isCurrency, money } from "./money";
import type { Currency } from "./money";
import { err, ok } from "./result";
import type { Result } from "./result";
import { findLink, linkSchema, moneySchema } from "./schemas";

export type OrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
export type CaptureStatus = "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";

export type Payer = { name: string | null; email: string | null; payerId: string | null };

export type CreateOrderInput = {
  /** Our booking id, sent as purchase_units[0].custom_id: webhooks carry it back. */
  bookingId: string;
  /** The 6-char booking ref shown to clients (purchase_units[0].reference_id). */
  ref: string;
  description: string;
  currency: Currency;
  depositCents: number;
  /** Kitoko's booking fee, paid by the client on top of the deposit. 0 = no fee line. */
  feeCents: number;
  returnUrl: string;
  cancelUrl: string;
  /** App locale (en, fr, it, es, pt) or a PayPal locale (fr-FR). */
  locale: string;
  /** Stable key for this order (our payment row id). Also makes invoice_id unique per order. */
  requestId: string;
};

export type CreatedOrder = { orderId: string; approveUrl: string; status: string };

export type PayPalOrder = {
  orderId: string;
  status: string;
  customId: string | null;
  amountCents: number | null;
  currency: Currency | null;
  approveUrl: string | null;
  capture: CaptureInfo | null;
  payer: Payer | null;
};

export type CaptureInfo = {
  captureId: string;
  status: string;
  amountCents: number | null;
  currency: Currency | null;
  /** status_details.reason, e.g. PENDING_REVIEW or UNILATERAL for a PENDING capture. */
  reason: string | null;
};

export type CapturedOrder = {
  orderId: string;
  /** Capture status: COMPLETED, or PENDING (funds held; PAYMENT.CAPTURE.COMPLETED follows by webhook). */
  status: string;
  captureId: string;
  amountCents: number;
  currency: Currency;
  customId: string | null;
  pendingReason: string | null;
  payer: Payer;
  /** True when PayPal said ORDER_ALREADY_CAPTURED and the capture was read back from the order. */
  alreadyCaptured: boolean;
};

const PAYPAL_LOCALES: Record<string, string> = { en: "en-GB", fr: "fr-FR", it: "it-IT", es: "es-ES", pt: "pt-PT" };
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

/** App locale → PayPal experience_context.locale. Unknown values are dropped (PayPal then uses the buyer's). */
export function paypalLocale(locale: string): string | undefined {
  const mapped = PAYPAL_LOCALES[locale.slice(0, 2).toLowerCase()];
  if (LOCALE_PATTERN.test(locale) && locale.includes("-")) return locale;
  return mapped;
}

const ITEM_NAMES: Record<string, { deposit: string; fee: string }> = {
  en: { deposit: "Deposit", fee: "Booking fee" },
  fr: { deposit: "Acompte", fee: "Frais de réservation" },
  it: { deposit: "Acconto", fee: "Costo di prenotazione" },
  es: { deposit: "Depósito", fee: "Gastos de reserva" },
  pt: { deposit: "Sinal", fee: "Taxa de reserva" },
};

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const payerSchema = z.object({
  name: z.object({ given_name: z.string().optional(), surname: z.string().optional() }).optional(),
  email_address: z.string().optional(),
  payer_id: z.string().optional(),
});

const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: moneySchema.optional(),
  custom_id: z.string().optional(),
  status_details: z.object({ reason: z.string().optional() }).optional(),
});

export const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(linkSchema).optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        amount: moneySchema.optional(),
        payments: z.object({ captures: z.array(captureSchema).optional() }).optional(),
      }),
    )
    .optional(),
  payer: payerSchema.optional(),
  payment_source: z
    .object({
      paypal: z
        .object({
          name: z.object({ given_name: z.string().optional(), surname: z.string().optional() }).optional(),
          email_address: z.string().optional(),
          account_id: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});
type RawOrder = z.output<typeof orderSchema>;

function payerOf(o: RawOrder): Payer {
  const p = o.payer;
  const w = o.payment_source?.paypal;
  const n = p?.name ?? w?.name;
  const name = [n?.given_name, n?.surname].filter(Boolean).join(" ").trim();
  return {
    name: name || null,
    email: p?.email_address ?? w?.email_address ?? null,
    payerId: p?.payer_id ?? w?.account_id ?? null,
  };
}

function toOrder(o: RawOrder): PayPalOrder {
  const unit = o.purchase_units?.[0];
  const amount = fromMoney(unit?.amount);
  const c = unit?.payments?.captures?.[0];
  const cAmount = fromMoney(c?.amount);
  const payer = payerOf(o);
  return {
    orderId: o.id,
    status: o.status,
    customId: unit?.custom_id ?? c?.custom_id ?? null,
    amountCents: amount?.cents ?? null,
    currency: amount?.currency ?? null,
    approveUrl: findLink(o.links, "payer-action", "approve"),
    capture: c
      ? { captureId: c.id, status: c.status, amountCents: cAmount?.cents ?? null, currency: cAmount?.currency ?? null, reason: c.status_details?.reason ?? null }
      : null,
    payer: payer.name || payer.email || payer.payerId ? payer : null,
  };
}

const validCents = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;

/**
 * POST /v2/checkout/orders: one purchase unit, two items (deposit + booking fee) summing to item_total, PayPal wallet
 * experience (PAY_NOW, NO_SHIPPING, brand Kitoko). Returns the payer-action URL the client opens to approve.
 */
export async function createOrder(input: CreateOrderInput, client: PayPalClient = defaultClient()): Promise<Result<CreatedOrder, PayPalError>> {
  if (!isCurrency(input.currency)) return err(paypalError("unprocessable", `Unsupported currency ${String(input.currency)}`));
  if (!validCents(input.depositCents, 1) || !validCents(input.feeCents, 0)) {
    return err(paypalError("unprocessable", "depositCents must be a positive integer and feeCents a non-negative integer"));
  }
  const names = ITEM_NAMES[input.locale.slice(0, 2).toLowerCase()] ?? ITEM_NAMES.en!;
  const totalCents = input.depositCents + input.feeCents;
  const items = [{ name: names.deposit, quantity: "1", unit_amount: money(input.depositCents, input.currency) }];
  if (input.feeCents > 0) items.push({ name: names.fee, quantity: "1", unit_amount: money(input.feeCents, input.currency) });
  const locale = paypalLocale(input.locale);

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.ref,
        custom_id: input.bookingId,
        // invoice_id must be unique per merchant across all orders: a second order for the same booking gets its own.
        invoice_id: truncate(`${input.ref}-${input.requestId}`, 127),
        description: truncate(input.description, 127),
        amount: {
          ...money(totalCents, input.currency),
          breakdown: { item_total: money(totalCents, input.currency) },
        },
        items,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Kitoko",
          ...(locale ? { locale } : {}),
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          landing_page: "NO_PREFERENCE",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  };

  const res = await client.request({ method: "POST", path: "/v2/checkout/orders", requestId: input.requestId, body }, orderSchema);
  if (!res.ok) return res;
  const approveUrl = findLink(res.value.links, "payer-action", "approve");
  if (!approveUrl) return err(paypalError("unknown", `Order ${res.value.id} came back without an approval link`, { issue: "NO_APPROVE_LINK" }));
  return ok({ orderId: res.value.id, approveUrl, status: res.value.status });
}

/** GET /v2/checkout/orders/{id}. */
export async function getOrder(orderId: string, client: PayPalClient = defaultClient()): Promise<Result<PayPalOrder, PayPalError>> {
  const res = await client.request({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}` }, orderSchema);
  return res.ok ? ok(toOrder(res.value)) : res;
}

function toCaptured(o: PayPalOrder, payer: Payer, alreadyCaptured: boolean): Result<CapturedOrder, PayPalError> {
  const c = o.capture;
  if (!c || c.amountCents === null || c.currency === null) {
    return err(paypalError("unknown", `Order ${o.orderId} has no readable capture`, { issue: "NO_CAPTURE" }));
  }
  if (c.status === "DECLINED" || c.status === "FAILED") {
    return err(paypalError("declined", `Capture ${c.captureId} ${c.status.toLowerCase()}`, { issue: c.reason ?? c.status }));
  }
  return ok({
    orderId: o.orderId,
    status: c.status,
    captureId: c.captureId,
    amountCents: c.amountCents,
    currency: c.currency,
    customId: o.customId,
    pendingReason: c.status === "PENDING" ? c.reason : null,
    payer,
    alreadyCaptured,
  });
}

/**
 * POST /v2/checkout/orders/{id}/capture with Prefer: return=representation. The default request id is
 * `capture-{orderId}`, so the return page and the webhook backstop share one idempotent capture. A 422
 * ORDER_ALREADY_CAPTURED is turned into the existing capture. INSTRUMENT_DECLINED → `declined` (the buyer can
 * approve again with another funding source).
 */
export async function captureOrder(
  input: { orderId: string; requestId?: string },
  client: PayPalClient = defaultClient(),
): Promise<Result<CapturedOrder, PayPalError>> {
  const res = await client.request(
    {
      method: "POST",
      path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
      requestId: input.requestId ?? `capture-${input.orderId}`,
      prefer: "return=representation",
      body: {},
    },
    orderSchema,
  );
  if (res.ok) return toCaptured(toOrder(res.value), payerOf(res.value), false);
  if (res.error.code !== "already_captured") return res;
  const existing = await getOrder(input.orderId, client);
  if (!existing.ok) return res;
  return toCaptured(existing.value, existing.value.payer ?? { name: null, email: null, payerId: null }, true);
}
