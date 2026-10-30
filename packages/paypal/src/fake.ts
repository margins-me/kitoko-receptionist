// An in-process fake of the PayPal REST endpoints Kitoko uses, behind the same `fetch` contract. PAYPAL_ENV=fake routes
// the default client here (local dev without credentials, and tests). It is deliberately strict where Kitoko has
// invariants: every POST other than the OAuth one must carry PayPal-Request-Id, and amounts must add up.

import { centsToValue, valueToCents } from "./money";

type Json = Record<string, unknown>;
type Money = { currency_code: string; value: string };

export type FakeRequest = { method: string; path: string; url: string; headers: Record<string, string>; body: unknown };
export type FakeWebhookEvent = {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  resource_version: string;
  event_type: string;
  summary: string;
  resource: Json;
  links: { href: string; rel: string; method: string }[];
};
export type FakePayer = { givenName: string; surname: string; email: string; payerId: string };
export type CaptureOutcome = "completed" | "pending" | "declined";

type StoredOrder = {
  id: string;
  status: string;
  createTime: string;
  purchaseUnit: Json & { amount: Money; custom_id?: string; invoice_id?: string };
  returnUrl: string | null;
  cancelUrl: string | null;
  payer: FakePayer | null;
  captureId: string | null;
  outcome: CaptureOutcome;
};
type StoredCapture = {
  id: string;
  orderId: string;
  status: string;
  reason: string | null;
  amount: Money;
  refundedCents: number;
  customId: string | null;
  invoiceId: string | null;
  createTime: string;
};
type StoredRefund = { id: string; captureId: string; status: string; amount: Money; note: string | null; customId: string | null; createTime: string };
type StoredPayoutItem = {
  id: string;
  batchId: string;
  status: string;
  transactionId: string;
  amount: { currency: string; value: string };
  receiver: string;
  senderItemId: string;
  note: string;
};
type StoredBatch = { id: string; senderBatchId: string; itemIds: string[]; createTime: string };
type StoredInvoice = { id: string; status: string; detail: Json; recipients: unknown; items: Json[]; currency: string; totalCents: number };
type StoredTransaction = { id: string; eventCode: string; date: string; amount: Money; customField: string | null; invoiceId: string | null; referenceId: string | null; payerEmail: string | null };

export type FakePayPal = {
  /** Drop-in for global fetch: pass it as `deps.fetch`. */
  fetch: typeof fetch;
  /**
   * The buyer approves the order (what the PayPal page does). Returns the return_url PayPal would redirect to
   * (`?token={orderId}&PayerID=…`), or null when the order is unknown or not awaiting approval.
   */
  approve(orderId: string, payer?: Partial<FakePayer>): { returnUrl: string } | null;
  /** The buyer cancels: returns the cancel_url with `?token={orderId}`. */
  cancel(orderId: string): { cancelUrl: string } | null;
  /** What the next capture of this order does: 422 INSTRUMENT_DECLINED, a PENDING capture, or COMPLETED (default). */
  setCaptureOutcome(orderId: string, outcome: CaptureOutcome): void;
  /** Settle a PENDING capture (emits PAYMENT.CAPTURE.COMPLETED or PAYMENT.CAPTURE.DECLINED). */
  settleCapture(captureId: string, status: "COMPLETED" | "DECLINED"): boolean;
  /** Change a payout item's transaction_status (emits the matching PAYMENT.PAYOUTS-ITEM.* event). */
  setPayoutItemStatus(payoutItemId: string, status: "SUCCESS" | "FAILED" | "UNCLAIMED" | "RETURNED" | "BLOCKED" | "ONHOLD" | "REFUNDED"): boolean;
  /** The client pays the invoice (emits INVOICING.INVOICE.PAID). */
  payInvoice(invoiceId: string): boolean;
  /** Make verify-webhook-signature answer FAILURE (true) or SUCCESS (false, default). */
  failWebhookVerification(fail: boolean): void;
  /** Invalidate every issued access token (the next call gets a 401). */
  expireTokens(): void;
  /** Every request received, in order. */
  readonly requests: FakeRequest[];
  /** Webhook events PayPal would have sent, in order, shaped like the real ones. */
  readonly events: FakeWebhookEvent[];
  getOrder(orderId: string): { status: string; captureId: string | null; customId: string | null } | null;
  reset(): void;
};

export type FakeOptions = {
  /** Base URL of the app, for the fake approval page. Default: SITE_URL or http://localhost:3300. */
  siteUrl?: string | (() => string);
  now?: () => number;
};

const DEFAULT_PAYER: FakePayer = { givenName: "Ada", surname: "Sandbox", email: "buyer@example.com", payerId: "FAKEPAYER0001" };
const API = "https://api-m.sandbox.paypal.com";

export function createFakePayPal(options: FakeOptions = {}): FakePayPal {
  const now = options.now ?? (() => Date.now());
  const siteUrl = (): string => {
    const s = typeof options.siteUrl === "function" ? options.siteUrl() : options.siteUrl;
    return (s ?? process.env.SITE_URL ?? "http://localhost:3300").replace(/\/+$/, "");
  };

  let seq = 0;
  // A per-instance tag: ids stay unique across processes (dev server restarts, test runs) sharing one database.
  const run = String(1000 + Math.floor(Math.random() * 9000));
  const id = (prefix: string) => `${prefix}${run}${String(++seq).padStart(6, "0")}`;
  const iso = () => `${new Date(now()).toISOString().slice(0, 19)}Z`;

  const requests: FakeRequest[] = [];
  const events: FakeWebhookEvent[] = [];
  const tokens = new Set<string>();
  const idempotency = new Map<string, { status: number; body: unknown }>();
  const orders = new Map<string, StoredOrder>();
  const captures = new Map<string, StoredCapture>();
  const refunds = new Map<string, StoredRefund>();
  const payoutItems = new Map<string, StoredPayoutItem>();
  const batches = new Map<string, StoredBatch>();
  const invoices = new Map<string, StoredInvoice>();
  const transactions: StoredTransaction[] = [];
  let verificationFails = false;

  function emit(eventType: string, resourceType: string, summary: string, resource: Json) {
    events.push({
      id: id("WH-FAKE-"),
      event_version: "1.0",
      create_time: iso(),
      resource_type: resourceType,
      resource_version: "2.0",
      event_type: eventType,
      summary,
      resource,
      links: [],
    });
  }

  // ---- representations ---------------------------------------------------------------------------------------------

  /** The app the buyer came from: the order's return_url origin (a dev server on any port), else SITE_URL. */
  const appUrl = (o: StoredOrder): string => {
    try {
      if (o.returnUrl) return new URL(o.returnUrl).origin;
    } catch {
      // not a URL: SITE_URL
    }
    return siteUrl();
  };

  const orderLinks = (o: StoredOrder) => [
    { href: `${API}/v2/checkout/orders/${o.id}`, rel: "self", method: "GET" },
    ...(o.status === "PAYER_ACTION_REQUIRED" || o.status === "CREATED"
      ? [{ href: `${appUrl(o)}/pay/fake-approve?token=${o.id}`, rel: o.status === "CREATED" ? "approve" : "payer-action", method: "GET" }]
      : []),
    ...(o.status === "APPROVED" ? [{ href: `${API}/v2/checkout/orders/${o.id}/capture`, rel: "capture", method: "POST" }] : []),
  ];

  const captureJson = (c: StoredCapture): Json => ({
    id: c.id,
    status: c.status,
    ...(c.reason ? { status_details: { reason: c.reason } } : {}),
    amount: c.amount,
    final_capture: true,
    ...(c.customId ? { custom_id: c.customId } : {}),
    ...(c.invoiceId ? { invoice_id: c.invoiceId } : {}),
    supplementary_data: { related_ids: { order_id: c.orderId } },
    create_time: c.createTime,
    update_time: c.createTime,
    links: [
      { href: `${API}/v2/payments/captures/${c.id}`, rel: "self", method: "GET" },
      { href: `${API}/v2/payments/captures/${c.id}/refund`, rel: "refund", method: "POST" },
      { href: `${API}/v2/checkout/orders/${c.orderId}`, rel: "up", method: "GET" },
    ],
  });

  const payerJson = (p: FakePayer) => ({ name: { given_name: p.givenName, surname: p.surname }, email_address: p.email, payer_id: p.payerId });

  const orderJson = (o: StoredOrder): Json => {
    const c = o.captureId ? captures.get(o.captureId) : undefined;
    return {
      id: o.id,
      intent: "CAPTURE",
      status: o.status,
      create_time: o.createTime,
      purchase_units: [{ ...o.purchaseUnit, ...(c ? { payments: { captures: [captureJson(c)] } } : {}) }],
      ...(o.payer
        ? {
            payer: payerJson(o.payer),
            payment_source: {
              paypal: { email_address: o.payer.email, account_id: o.payer.payerId, name: { given_name: o.payer.givenName, surname: o.payer.surname } },
            },
          }
        : {}),
      links: orderLinks(o),
    };
  };

  const refundJson = (r: StoredRefund): Json => ({
    id: r.id,
    status: r.status,
    amount: r.amount,
    ...(r.note ? { note_to_payer: r.note } : {}),
    ...(r.customId ? { custom_id: r.customId } : {}),
    create_time: r.createTime,
    links: [
      { href: `${API}/v2/payments/refunds/${r.id}`, rel: "self", method: "GET" },
      { href: `${API}/v2/payments/captures/${r.captureId}`, rel: "up", method: "GET" },
    ],
  });

  const payoutItemJson = (i: StoredPayoutItem): Json => {
    const batch = batches.get(i.batchId);
    return {
      payout_item_id: i.id,
      transaction_id: i.transactionId,
      transaction_status: i.status,
      payout_batch_id: i.batchId,
      sender_batch_id: batch?.senderBatchId,
      payout_item_fee: { currency: i.amount.currency, value: "0.00" },
      payout_item: { recipient_type: "EMAIL", amount: i.amount, note: i.note, receiver: i.receiver, sender_item_id: i.senderItemId },
      time_processed: batch?.createTime,
      ...(i.status === "FAILED" ? { errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" } } : {}),
      links: [{ href: `${API}/v1/payments/payouts-item/${i.id}`, rel: "item", method: "GET" }],
    };
  };

  const batchStatus = (b: StoredBatch) => (b.itemIds.every((iid) => payoutItems.get(iid)?.status !== "PENDING") ? "SUCCESS" : "PROCESSING");

  const batchHeaderJson = (b: StoredBatch, status: string): Json => {
    const items = b.itemIds.map((iid) => payoutItems.get(iid)).filter((i): i is StoredPayoutItem => !!i);
    const total = items.reduce((s, i) => s + (valueToCents(i.amount.value) ?? 0), 0);
    return {
      payout_batch_id: b.id,
      batch_status: status,
      time_created: b.createTime,
      sender_batch_header: { sender_batch_id: b.senderBatchId },
      amount: { currency: items[0]?.amount.currency ?? "EUR", value: centsToValue(total) },
    };
  };

  const invoiceJson = (inv: StoredInvoice): Json => ({
    id: inv.id,
    status: inv.status,
    detail: {
      ...inv.detail,
      metadata: {
        create_time: iso(),
        recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`,
        invoicer_view_url: `https://www.sandbox.paypal.com/invoice/details/${inv.id}`,
      },
    },
    primary_recipients: inv.recipients,
    items: inv.items,
    amount: { currency_code: inv.currency, value: centsToValue(inv.totalCents) },
    links: [{ href: `${API}/v2/invoicing/invoices/${inv.id}`, rel: "self", method: "GET" }],
  });

  // ---- helpers -----------------------------------------------------------------------------------------------------

  const fail = (status: number, name: string, issue?: string, description?: string) => ({
    status,
    body: {
      name,
      message: description ?? name,
      debug_id: id("fakedebug"),
      ...(issue ? { details: [{ issue, description: description ?? issue }] } : {}),
    },
  });
  const notFound = (what: string) => fail(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", `${what} not found`);
  const cents = (m: unknown): number | null => {
    const v = (m as Money | undefined)?.value;
    return typeof v === "string" ? valueToCents(v) : null;
  };

  function record(t: Omit<StoredTransaction, "id" | "date">) {
    transactions.push({ id: id("FKTXN"), date: iso(), ...t });
  }

  // ---- routes ------------------------------------------------------------------------------------------------------

  type Out = { status: number; body: unknown };

  function createOrder(body: Json, prefer: string | null): Out {
    if (body.intent !== "CAPTURE") return fail(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "intent must be CAPTURE");
    const units = body.purchase_units as Json[] | undefined;
    const unit = units?.[0] as StoredOrder["purchaseUnit"] | undefined;
    const total = cents(unit?.amount);
    if (!unit || total === null || total <= 0) return fail(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "purchase_units[0].amount");
    const items = (unit.items as { quantity: string; unit_amount: Money }[] | undefined) ?? [];
    const breakdown = (unit.amount as Json).breakdown as { item_total?: Money } | undefined;
    if (items.length > 0) {
      const sum = items.reduce((s, i) => s + (cents(i.unit_amount) ?? 0) * Number(i.quantity), 0);
      if (sum !== cents(breakdown?.item_total)) return fail(422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_MISMATCH");
    }
    if (breakdown?.item_total && cents(breakdown.item_total) !== total) return fail(422, "UNPROCESSABLE_ENTITY", "AMOUNT_MISMATCH");
    const ctx = ((body.payment_source as Json | undefined)?.paypal as Json | undefined)?.experience_context as Json | undefined;
    const o: StoredOrder = {
      id: id("FKORD"),
      status: ctx ? "PAYER_ACTION_REQUIRED" : "CREATED",
      createTime: iso(),
      purchaseUnit: { ...unit, reference_id: (unit.reference_id as string | undefined) ?? "default" },
      returnUrl: typeof ctx?.return_url === "string" ? ctx.return_url : null,
      cancelUrl: typeof ctx?.cancel_url === "string" ? ctx.cancel_url : null,
      payer: null,
      captureId: null,
      outcome: "completed",
    };
    orders.set(o.id, o);
    const json = orderJson(o);
    return { status: 200, body: prefer === "return=representation" ? json : { id: o.id, status: o.status, links: json.links } };
  }

  function captureOrder(orderId: string): Out {
    const o = orders.get(orderId);
    if (!o) return notFound(`Order ${orderId}`);
    if (o.status === "COMPLETED") return fail(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED", "Order already captured.");
    if (o.status !== "APPROVED") return fail(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.");
    if (o.outcome === "declined") {
      o.status = "PAYER_ACTION_REQUIRED";
      o.outcome = "completed";
      return fail(422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED", "The instrument presented was either declined by the processor or bank, or it can't be used for this payment.");
    }
    const pending = o.outcome === "pending";
    const c: StoredCapture = {
      id: id("FKCAP"),
      orderId: o.id,
      status: pending ? "PENDING" : "COMPLETED",
      reason: pending ? "PENDING_REVIEW" : null,
      amount: { currency_code: o.purchaseUnit.amount.currency_code, value: o.purchaseUnit.amount.value },
      refundedCents: 0,
      customId: o.purchaseUnit.custom_id ?? null,
      invoiceId: o.purchaseUnit.invoice_id ?? null,
      createTime: iso(),
    };
    captures.set(c.id, c);
    o.captureId = c.id;
    o.status = "COMPLETED";
    if (pending) {
      emit("PAYMENT.CAPTURE.PENDING", "capture", `Payment pending for ${c.amount.value} ${c.amount.currency_code}`, captureJson(c));
    } else {
      record({ eventCode: "T0006", amount: c.amount, customField: c.customId, invoiceId: c.invoiceId, referenceId: null, payerEmail: o.payer?.email ?? null });
      emit("PAYMENT.CAPTURE.COMPLETED", "capture", `Payment completed for ${c.amount.value} ${c.amount.currency_code}`, captureJson(c));
    }
    return { status: 201, body: orderJson(o) };
  }

  function refund(captureId: string, body: Json, prefer: string | null): Out {
    const c = captures.get(captureId);
    if (!c) return notFound(`Capture ${captureId}`);
    if (c.status === "REFUNDED") return fail(422, "UNPROCESSABLE_ENTITY", "CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded");
    if (c.status !== "COMPLETED" && c.status !== "PARTIALLY_REFUNDED") return fail(422, "UNPROCESSABLE_ENTITY", "TRANSACTION_REFUSED");
    const captured = cents(c.amount) ?? 0;
    const remaining = captured - c.refundedCents;
    const amount = body.amount as Money | undefined;
    const want = amount ? cents(amount) : remaining;
    if (want === null || want <= 0) return fail(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "amount.value");
    if (amount && amount.currency_code !== c.amount.currency_code) return fail(422, "UNPROCESSABLE_ENTITY", "REFUND_CURRENCY_MISMATCH");
    if (want > remaining) return fail(422, "UNPROCESSABLE_ENTITY", "REFUND_AMOUNT_EXCEEDED", "The refund amount must be less than or equal to the capture amount that has not yet been refunded.");
    c.refundedCents += want;
    c.status = c.refundedCents === captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const r: StoredRefund = {
      id: id("FKREF"),
      captureId,
      status: "COMPLETED",
      amount: { currency_code: c.amount.currency_code, value: centsToValue(want) },
      note: typeof body.note_to_payer === "string" ? body.note_to_payer : null,
      customId: c.customId,
      createTime: iso(),
    };
    refunds.set(r.id, r);
    record({ eventCode: "T1107", amount: { currency_code: r.amount.currency_code, value: `-${r.amount.value}` }, customField: c.customId, invoiceId: c.invoiceId, referenceId: c.id, payerEmail: null });
    emit("PAYMENT.CAPTURE.REFUNDED", "refund", `A ${r.amount.value} ${r.amount.currency_code} capture payment was refunded`, refundJson(r));
    const json = refundJson(r);
    return { status: 201, body: prefer === "return=representation" ? json : { id: r.id, status: r.status, links: json.links } };
  }

  function createPayout(body: Json): Out {
    const header = body.sender_batch_header as Json | undefined;
    const items = body.items as Json[] | undefined;
    if (typeof header?.sender_batch_id !== "string" || !items?.length) return fail(400, "VALIDATION_ERROR", "MISSING_REQUIRED_PARAMETER", "sender_batch_header and items are required");
    const batch: StoredBatch = { id: id("FKBATCH"), senderBatchId: header.sender_batch_id, itemIds: [], createTime: iso() };
    for (const raw of items) {
      const amount = raw.amount as { currency: string; value: string } | undefined;
      if (!amount || valueToCents(amount.value) === null || typeof raw.receiver !== "string") return fail(400, "VALIDATION_ERROR", "INVALID_PARAMETER_VALUE", "items[].amount/receiver");
      const item: StoredPayoutItem = {
        id: id("FKITEM"),
        batchId: batch.id,
        status: "SUCCESS",
        transactionId: id("FKPTX"),
        amount,
        receiver: raw.receiver,
        senderItemId: typeof raw.sender_item_id === "string" ? raw.sender_item_id : "",
        note: typeof raw.note === "string" ? raw.note : "",
      };
      payoutItems.set(item.id, item);
      batch.itemIds.push(item.id);
      record({ eventCode: "T0000", amount: { currency_code: amount.currency, value: `-${amount.value}` }, customField: item.senderItemId, invoiceId: null, referenceId: null, payerEmail: item.receiver });
    }
    batches.set(batch.id, batch);
    for (const iid of batch.itemIds) {
      const item = payoutItems.get(iid)!;
      emit("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "payouts_item", "A payout item has succeeded", payoutItemJson(item));
    }
    emit("PAYMENT.PAYOUTSBATCH.SUCCESS", "payouts", "Payouts batch completed successfully.", { batch_header: batchHeaderJson(batch, "SUCCESS") });
    return {
      status: 201,
      body: {
        batch_header: { ...batchHeaderJson(batch, "PENDING"), sender_batch_header: header },
        links: [{ href: `${API}/v1/payments/payouts/${batch.id}`, rel: "self", method: "GET" }],
      },
    };
  }

  function createInvoice(body: Json, prefer: string | null): Out {
    const detail = (body.detail as Json | undefined) ?? {};
    const currency = detail.currency_code;
    const items = (body.items as Json[] | undefined) ?? [];
    if (typeof currency !== "string" || items.length === 0) return fail(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "detail.currency_code and items");
    let total = 0;
    for (const i of items) {
      const c = cents(i.unit_amount);
      if (c === null) return fail(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "items[].unit_amount");
      total += c * Number(i.quantity ?? 1);
    }
    const inv: StoredInvoice = {
      id: id("INV2-FAKE-"),
      status: "DRAFT",
      detail: { ...detail, invoice_number: String(invoices.size + 1).padStart(4, "0") },
      recipients: body.primary_recipients,
      items,
      currency,
      totalCents: total,
    };
    invoices.set(inv.id, inv);
    const self = { href: `${API}/v2/invoicing/invoices/${inv.id}`, rel: "self", method: "GET" };
    return { status: 201, body: prefer === "return=representation" ? invoiceJson(inv) : self };
  }

  function sendInvoice(invoiceId: string): Out {
    const inv = invoices.get(invoiceId);
    if (!inv) return notFound(`Invoice ${invoiceId}`);
    if (inv.status !== "DRAFT") return fail(422, "UNPROCESSABLE_ENTITY", "INVALID_INVOICE_STATUS", "Invoice already sent");
    inv.status = "SENT";
    return { status: 200, body: { href: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`, rel: "payer-view", method: "GET" } };
  }

  function listTransactions(q: URLSearchParams): Out {
    const start = Date.parse(q.get("start_date") ?? "");
    const end = Date.parse(q.get("end_date") ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) return fail(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "start_date and end_date");
    if (end - start > 31 * 86_400_000) return fail(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "Date range is greater than 31 days");
    const pageSize = Number(q.get("page_size") ?? 100);
    const page = Number(q.get("page") ?? 1);
    const rows = transactions.filter((t) => {
      const d = Date.parse(t.date);
      return d >= start && d <= end;
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    return {
      status: 200,
      body: {
        transaction_details: rows.slice((page - 1) * pageSize, page * pageSize).map((t) => ({
          transaction_info: {
            transaction_id: t.id,
            transaction_event_code: t.eventCode,
            transaction_initiation_date: t.date,
            transaction_updated_date: t.date,
            transaction_amount: t.amount,
            fee_amount: { currency_code: t.amount.currency_code, value: "0.00" },
            transaction_status: "S",
            ...(t.customField ? { custom_field: t.customField } : {}),
            ...(t.invoiceId ? { invoice_id: t.invoiceId } : {}),
            ...(t.referenceId ? { paypal_reference_id: t.referenceId, paypal_reference_id_type: "TXN" } : {}),
          },
          payer_info: t.payerEmail ? { email_address: t.payerEmail, payer_name: { alternate_full_name: `${DEFAULT_PAYER.givenName} ${DEFAULT_PAYER.surname}` } } : {},
        })),
        account_number: "FAKEACCOUNT",
        start_date: q.get("start_date"),
        end_date: q.get("end_date"),
        last_refreshed_datetime: iso(),
        page,
        total_items: rows.length,
        total_pages: totalPages,
      },
    };
  }

  function verify(body: Json): Out {
    const required = ["auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time", "webhook_id"];
    if (required.some((k) => typeof body[k] !== "string") || typeof body.webhook_event !== "object" || body.webhook_event === null) {
      return fail(400, "VALIDATION_ERROR", "MISSING_REQUIRED_PARAMETER", "verify-webhook-signature fields");
    }
    return { status: 200, body: { verification_status: verificationFails ? "FAILURE" : "SUCCESS" } };
  }

  function route(method: string, path: string, q: URLSearchParams, body: Json, prefer: string | null): Out {
    let m: RegExpExecArray | null;
    if (method === "POST" && path === "/v2/checkout/orders") return createOrder(body, prefer);
    if (method === "GET" && (m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path))) {
      const o = orders.get(decodeURIComponent(m[1]!));
      return o ? { status: 200, body: orderJson(o) } : notFound(`Order ${m[1]}`);
    }
    if (method === "POST" && (m = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(path))) return captureOrder(decodeURIComponent(m[1]!));
    if (method === "POST" && (m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path))) return refund(decodeURIComponent(m[1]!), body, prefer);
    if (method === "GET" && (m = /^\/v2\/payments\/refunds\/([^/]+)$/.exec(path))) {
      const r = refunds.get(decodeURIComponent(m[1]!));
      return r ? { status: 200, body: refundJson(r) } : notFound(`Refund ${m[1]}`);
    }
    if (method === "POST" && path === "/v1/payments/payouts") return createPayout(body);
    if (method === "GET" && (m = /^\/v1\/payments\/payouts\/([^/]+)$/.exec(path))) {
      const b = batches.get(decodeURIComponent(m[1]!));
      if (!b) return notFound(`Batch ${m[1]}`);
      return {
        status: 200,
        body: {
          batch_header: batchHeaderJson(b, batchStatus(b)),
          items: b.itemIds.map((iid) => payoutItemJson(payoutItems.get(iid)!)),
          total_items: b.itemIds.length,
          total_pages: 1,
        },
      };
    }
    if (method === "GET" && (m = /^\/v1\/payments\/payouts-item\/([^/]+)$/.exec(path))) {
      const i = payoutItems.get(decodeURIComponent(m[1]!));
      return i ? { status: 200, body: payoutItemJson(i) } : notFound(`Payout item ${m[1]}`);
    }
    if (method === "POST" && path === "/v2/invoicing/invoices") return createInvoice(body, prefer);
    if (method === "POST" && (m = /^\/v2\/invoicing\/invoices\/([^/]+)\/send$/.exec(path))) return sendInvoice(decodeURIComponent(m[1]!));
    if (method === "GET" && (m = /^\/v2\/invoicing\/invoices\/([^/]+)$/.exec(path))) {
      const inv = invoices.get(decodeURIComponent(m[1]!));
      return inv ? { status: 200, body: invoiceJson(inv) } : notFound(`Invoice ${m[1]}`);
    }
    if (method === "POST" && path === "/v2/invoicing/generate-next-invoice-number") {
      return { status: 200, body: { invoice_number: String(invoices.size + 1).padStart(4, "0") } };
    }
    if (method === "GET" && path === "/v1/reporting/transactions") return listTransactions(q);
    if (method === "POST" && path === "/v1/notifications/verify-webhook-signature") return verify(body);
    return fail(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", `Fake PayPal has no route for ${method} ${path}`);
  }

  const respond = (out: Out, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { "content-type": "application/json", "paypal-debug-id": id("fakedebug"), ...headers },
    });

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const rawBody = typeof init?.body === "string" ? init.body : "";
    const headerRecord = Object.fromEntries(headers.entries());

    if (method === "POST" && url.pathname === "/v1/oauth2/token") {
      requests.push({ method, path: url.pathname, url: url.href, headers: headerRecord, body: rawBody });
      if (!headers.get("authorization")?.startsWith("Basic ")) return respond({ status: 401, body: { error: "invalid_client", error_description: "Client Authentication failed" } });
      const token = id("FAKE-ACCESS-TOKEN-");
      tokens.add(token);
      return respond({ status: 200, body: { scope: "https://uri.paypal.com/services/payments/payment", access_token: token, token_type: "Bearer", app_id: "APP-FAKE", expires_in: 32400, nonce: id("nonce") } });
    }

    let body: Json = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as Json;
      } catch {
        requests.push({ method, path: url.pathname, url: url.href, headers: headerRecord, body: rawBody });
        return respond(fail(400, "INVALID_REQUEST", "MALFORMED_REQUEST_JSON"));
      }
    }
    requests.push({ method, path: url.pathname, url: url.href, headers: headerRecord, body });

    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer || !tokens.has(bearer)) {
      return respond({ status: 401, body: { name: "AUTHENTICATION_FAILURE", message: "Authentication failed due to invalid authentication credentials or a missing Authorization header." } });
    }

    const requestId = headers.get("paypal-request-id");
    if (method === "POST" && !requestId) return respond(fail(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "PayPal-Request-Id header is required by Kitoko"));
    const key = requestId ? `${method} ${url.pathname} ${requestId}` : null;
    const replay = key ? idempotency.get(key) : undefined;
    if (replay) return respond(replay);

    const out = route(method, url.pathname, url.searchParams, body, headers.get("prefer"));
    // PayPal replays the first answer for a request id, successes and business failures alike.
    if (key && out.status < 500) idempotency.set(key, out);
    return respond(out);
  };

  function reset() {
    requests.length = 0;
    events.length = 0;
    transactions.length = 0;
    for (const m of [tokens, idempotency, orders, captures, refunds, payoutItems, batches, invoices]) m.clear();
    verificationFails = false;
  }

  return {
    fetch: fakeFetch,
    approve(orderId, payer) {
      const o = orders.get(orderId);
      if (!o || (o.status !== "PAYER_ACTION_REQUIRED" && o.status !== "CREATED")) return null;
      o.payer = { ...DEFAULT_PAYER, ...payer };
      o.status = "APPROVED";
      emit("CHECKOUT.ORDER.APPROVED", "checkout-order", "An order has been approved by buyer", orderJson(o));
      const u = new URL(o.returnUrl ?? `${appUrl(o)}/`);
      u.searchParams.set("token", o.id);
      u.searchParams.set("PayerID", o.payer.payerId);
      return { returnUrl: u.href };
    },
    cancel(orderId) {
      const o = orders.get(orderId);
      if (!o?.cancelUrl) return null;
      const u = new URL(o.cancelUrl);
      u.searchParams.set("token", o.id);
      return { cancelUrl: u.href };
    },
    setCaptureOutcome(orderId, outcome) {
      const o = orders.get(orderId);
      if (o) o.outcome = outcome;
    },
    settleCapture(captureId, status) {
      const c = captures.get(captureId);
      if (!c || c.status !== "PENDING") return false;
      c.status = status;
      c.reason = status === "DECLINED" ? "DECLINED_BY_RISK_FRAUD_FILTERS" : null;
      if (status === "COMPLETED") {
        record({ eventCode: "T0006", amount: c.amount, customField: c.customId, invoiceId: c.invoiceId, referenceId: null, payerEmail: null });
        emit("PAYMENT.CAPTURE.COMPLETED", "capture", `Payment completed for ${c.amount.value} ${c.amount.currency_code}`, captureJson(c));
      } else {
        emit("PAYMENT.CAPTURE.DECLINED", "capture", `Payment declined for ${c.amount.value} ${c.amount.currency_code}`, captureJson(c));
      }
      return true;
    },
    setPayoutItemStatus(payoutItemId, status) {
      const i = payoutItems.get(payoutItemId);
      if (!i) return false;
      i.status = status;
      const suffix = status === "SUCCESS" ? "SUCCEEDED" : status === "ONHOLD" ? "HELD" : status;
      emit(`PAYMENT.PAYOUTS-ITEM.${suffix}`, "payouts_item", `A payout item is ${status.toLowerCase()}`, payoutItemJson(i));
      return true;
    },
    payInvoice(invoiceId) {
      const inv = invoices.get(invoiceId);
      if (!inv || (inv.status !== "SENT" && inv.status !== "UNPAID")) return false;
      inv.status = "PAID";
      const amount = { currency_code: inv.currency, value: centsToValue(inv.totalCents) };
      record({ eventCode: "T0007", amount, customField: null, invoiceId: typeof inv.detail.reference === "string" ? inv.detail.reference : null, referenceId: null, payerEmail: null });
      emit("INVOICING.INVOICE.PAID", "invoices", `Invoice paid for ${amount.value} ${amount.currency_code}`, { invoice: invoiceJson(inv) });
      return true;
    },
    failWebhookVerification(f) {
      verificationFails = f;
    },
    expireTokens() {
      tokens.clear();
    },
    requests,
    events,
    getOrder(orderId) {
      const o = orders.get(orderId);
      return o ? { status: o.status, captureId: o.captureId, customId: o.purchaseUnit.custom_id ?? null } : null;
    },
    reset,
  };
}

const SHARED = Symbol.for("kitoko.paypal.fake");

/** The process-wide fake used when PAYPAL_ENV=fake (shared across route handlers and Next dev reloads). */
export function getFakePayPal(): FakePayPal {
  const g = globalThis as unknown as Record<symbol, FakePayPal | undefined>;
  g[SHARED] ??= createFakePayPal();
  return g[SHARED];
}
