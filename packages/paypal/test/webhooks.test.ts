import { describe, expect, it } from "vitest";
import { createClient } from "../src/client";
import { createFakePayPal } from "../src/fake";
import { captureOrder } from "../src/orders";
import { createPayout } from "../src/payouts";
import { refundCapture } from "../src/refunds";
import { createAndSendInvoice } from "../src/invoices";
import { PAYOUT_ITEM_EVENTS, parseEvent, verifyWebhook } from "../src/webhooks";
import { ENV, approvedOrder, setup } from "./helpers";

// Payloads modelled on PayPal's documented webhook samples, with EUR amounts and our custom_id.
const API = "https://api.sandbox.paypal.com";
const BOOKING = "b0b0b0b0-0000-4000-8000-000000000001";

const orderApproved = {
  id: "WH-COC11055RA711503B-4YM959094A144403T",
  create_time: "2026-10-27T09:21:49.000Z",
  event_type: "CHECKOUT.ORDER.APPROVED",
  event_version: "1.0",
  resource_type: "checkout-order",
  resource_version: "2.0",
  summary: "An order has been approved by buyer",
  resource: {
    id: "5O190127TN364715T",
    intent: "CAPTURE",
    status: "APPROVED",
    payer: { name: { given_name: "John", surname: "Doe" }, email_address: "buyer@example.com", payer_id: "QYR5Z8XDVJNXQ" },
    purchase_units: [{ reference_id: "K7Q2ZP", custom_id: BOOKING, amount: { currency_code: "EUR", value: "31.50" }, payee: { email_address: "seller@example.com" } }],
    create_time: "2026-10-27T09:18:49Z",
    links: [
      { href: `${API}/v2/checkout/orders/5O190127TN364715T`, rel: "self", method: "GET" },
      { href: `${API}/v2/checkout/orders/5O190127TN364715T/capture`, rel: "capture", method: "POST" },
    ],
  },
  links: [{ href: `${API}/v1/notifications/webhooks-events/WH-COC11055RA711503B-4YM959094A144403T`, rel: "self", method: "GET" }],
};

const capture = (eventType: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: "WH-58D329510W468432D-8HN650336L201105X",
  event_version: "1.0",
  create_time: "2026-10-27T09:50:07.940Z",
  resource_type: "capture",
  resource_version: "2.0",
  event_type: eventType,
  summary: "Payment completed for € 31.5 EUR",
  resource: {
    id: "27M47624FP291604U",
    status,
    amount: { currency_code: "EUR", value: "31.50" },
    final_capture: true,
    custom_id: BOOKING,
    invoice_id: "K7Q2ZP-pay-0001",
    seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
    seller_receivable_breakdown: {
      gross_amount: { currency_code: "EUR", value: "31.50" },
      paypal_fee: { currency_code: "EUR", value: "1.42" },
      net_amount: { currency_code: "EUR", value: "30.08" },
    },
    supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
    create_time: "2026-10-27T09:49:58Z",
    update_time: "2026-10-27T09:49:58Z",
    links: [
      { href: `${API}/v2/payments/captures/27M47624FP291604U`, rel: "self", method: "GET" },
      { href: `${API}/v2/payments/captures/27M47624FP291604U/refund`, rel: "refund", method: "POST" },
      { href: `${API}/v2/checkout/orders/5O190127TN364715T`, rel: "up", method: "GET" },
    ],
    ...extra,
  },
  links: [{ href: `${API}/v1/notifications/webhooks-events/WH-58D329510W468432D-8HN650336L201105X`, rel: "self", method: "GET" }],
});

const refunded = {
  id: "WH-1GE84257G0350133W-6RW800890C634293G",
  event_version: "1.0",
  create_time: "2026-10-27T11:14:04.543Z",
  resource_type: "refund",
  resource_version: "2.0",
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  summary: "A € 30.0 EUR capture payment was refunded",
  resource: {
    id: "1Y107995YT783435V",
    status: "COMPLETED",
    amount: { currency_code: "EUR", value: "30.00" },
    note_to_payer: "Annulation dans le délai gratuit",
    seller_payable_breakdown: {
      gross_amount: { currency_code: "EUR", value: "30.00" },
      paypal_fee: { currency_code: "EUR", value: "0.00" },
      net_amount: { currency_code: "EUR", value: "30.00" },
      total_refunded_amount: { currency_code: "EUR", value: "30.00" },
    },
    create_time: "2026-10-27T04:13:29-07:00",
    update_time: "2026-10-27T04:13:29-07:00",
    links: [
      { href: `${API}/v2/payments/refunds/1Y107995YT783435V`, rel: "self", method: "GET" },
      { href: `${API}/v2/payments/captures/27M47624FP291604U`, rel: "up", method: "GET" },
    ],
  },
  links: [{ href: `${API}/v1/notifications/webhooks-events/WH-1GE84257G0350133W-6RW800890C634293G`, rel: "self", method: "GET" }],
};

const payoutItem = (eventType: string, transactionStatus: string) => ({
  id: "WH-7Y7254563A4550640-11V2185806837105M",
  event_version: "1.0",
  create_time: "2026-10-27T23:53:13Z",
  resource_type: "payouts_item",
  event_type: eventType,
  summary: "A payout item has changed",
  resource: {
    payout_item_id: "8AELMXH8UB2P8",
    transaction_id: "0C413693MN970190K",
    transaction_status: transactionStatus,
    payout_item_fee: { currency: "EUR", value: "0.00" },
    payout_batch_id: "Q8KVJG9TZTNN4",
    sender_batch_id: "payout-row-1",
    payout_item: {
      amount: { currency: "EUR", value: "30.00" },
      recipient_type: "EMAIL",
      note: "Booking K7Q2ZP",
      receiver: "amara@example.com",
      sender_item_id: "payout-row-1",
    },
    time_processed: "2026-10-27T23:53:04Z",
    ...(transactionStatus === "FAILED" ? { errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" } } : {}),
    links: [{ href: `${API}/v1/payments/payouts-item/8AELMXH8UB2P8`, rel: "item", method: "GET" }],
  },
  links: [],
});

const payoutBatch = (eventType: string, status: string) => ({
  id: "WH-0LU96374794024348-4WG31854RU4949452",
  event_version: "1.0",
  create_time: "2026-10-27T23:53:13Z",
  resource_type: "payouts",
  event_type: eventType,
  summary: "Payouts batch completed successfully.",
  resource: {
    batch_header: {
      payout_batch_id: "Q8KVJG9TZTNN4",
      batch_status: status,
      time_created: "2026-10-27T23:52:57Z",
      time_completed: "2026-10-27T23:53:13Z",
      sender_batch_header: { sender_batch_id: "payout-row-1" },
      amount: { currency: "EUR", value: "30.00" },
      fees: { currency: "EUR", value: "0.00" },
      payments: 1,
    },
    links: [{ href: `${API}/v1/payments/payouts/Q8KVJG9TZTNN4`, rel: "self", method: "GET" }],
  },
  links: [],
});

const invoice = {
  id: "INV2-3RCT-8Z2B-4CZ3-YP6Z",
  status: "PAID",
  detail: { reference: "K7Q2ZP", currency_code: "GBP", invoice_number: "0042" },
  amount: { currency_code: "GBP", value: "90.00" },
  payments: { paid_amount: { currency_code: "GBP", value: "90.00" }, transactions: [{ payment_id: "TXNID123", method: "PAYPAL" }] },
};
const invoicePaid = (resource: unknown) => ({
  id: "WH-EVENT_ID",
  event_version: "1.0",
  create_time: "2026-10-27T10:30:45Z",
  resource_type: "invoices",
  event_type: "INVOICING.INVOICE.PAID",
  summary: "An invoice was paid",
  resource,
  links: [],
});

describe("parseEvent", () => {
  it("parses CHECKOUT.ORDER.APPROVED", () => {
    expect(parseEvent(JSON.stringify(orderApproved))).toEqual({
      ok: true,
      value: {
        eventId: orderApproved.id,
        createTime: orderApproved.create_time,
        resourceType: "checkout-order",
        summary: orderApproved.summary,
        kind: "order",
        eventType: "CHECKOUT.ORDER.APPROVED",
        orderId: "5O190127TN364715T",
        customId: BOOKING,
        status: "APPROVED",
        amountCents: 3150,
        currency: "EUR",
      },
    });
  });

  it.each([
    ["PAYMENT.CAPTURE.COMPLETED", "COMPLETED", null],
    ["PAYMENT.CAPTURE.PENDING", "PENDING", "PENDING_REVIEW"],
    ["PAYMENT.CAPTURE.DENIED", "DECLINED", "DECLINED_BY_RISK_FRAUD_FILTERS"],
    ["PAYMENT.CAPTURE.DECLINED", "DECLINED", "DECLINED_BY_RISK_FRAUD_FILTERS"],
  ])("parses %s", (type, status, reason) => {
    const body = capture(type, status, reason ? { status_details: { reason } } : {});
    expect(parseEvent(body)).toMatchObject({
      ok: true,
      value: { kind: "capture", eventType: type, captureId: "27M47624FP291604U", orderId: "5O190127TN364715T", customId: BOOKING, status, reason, amountCents: 3150, currency: "EUR" },
    });
  });

  it("falls back to the up link for the order id", () => {
    const body = capture("PAYMENT.CAPTURE.COMPLETED", "COMPLETED", { supplementary_data: undefined });
    expect(parseEvent(body)).toMatchObject({ ok: true, value: { orderId: "5O190127TN364715T" } });
  });

  it("parses PAYMENT.CAPTURE.REFUNDED with the capture id from the up link", () => {
    expect(parseEvent(refunded)).toMatchObject({
      ok: true,
      value: { kind: "refund", refundId: "1Y107995YT783435V", captureId: "27M47624FP291604U", status: "COMPLETED", amountCents: 3000, currency: "EUR" },
    });
  });

  it.each(
    PAYOUT_ITEM_EVENTS.map((t) => {
      const suffix = t.slice("PAYMENT.PAYOUTS-ITEM.".length);
      const status = ({ SUCCEEDED: "SUCCESS", HELD: "ONHOLD", CANCELED: "RETURNED", DENIED: "FAILED" } as Record<string, string>)[suffix] ?? suffix;
      return [t, status] as const;
    }),
  )("parses %s", (type, status) => {
    expect(parseEvent(payoutItem(type, status))).toMatchObject({
      ok: true,
      value: {
        kind: "payout_item",
        eventType: type,
        payoutItemId: "8AELMXH8UB2P8",
        payoutBatchId: "Q8KVJG9TZTNN4",
        senderItemId: "payout-row-1",
        transactionId: "0C413693MN970190K",
        status,
        amountCents: 3000,
        currency: "EUR",
        error: status === "FAILED" ? "RECEIVER_UNREGISTERED" : null,
      },
    });
  });

  it.each([
    ["PAYMENT.PAYOUTSBATCH.SUCCESS", "SUCCESS"],
    ["PAYMENT.PAYOUTSBATCH.DENIED", "DENIED"],
  ])("parses %s", (type, status) => {
    expect(parseEvent(payoutBatch(type, status))).toMatchObject({
      ok: true,
      value: { kind: "payout_batch", payoutBatchId: "Q8KVJG9TZTNN4", senderBatchId: "payout-row-1", status, amountCents: 3000, currency: "EUR" },
    });
  });

  it("parses INVOICING.INVOICE.PAID wrapped in resource.invoice or flat", () => {
    const expected = { kind: "invoice_paid", invoiceId: "INV2-3RCT-8Z2B-4CZ3-YP6Z", reference: "K7Q2ZP", status: "PAID", amountCents: 9000, currency: "GBP" };
    expect(parseEvent(invoicePaid({ invoice }))).toMatchObject({ ok: true, value: expected });
    expect(parseEvent(invoicePaid(invoice))).toMatchObject({ ok: true, value: expected });
  });

  it("acknowledges other event types as `other`", () => {
    const body = { ...orderApproved, event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "PP-D-1", id: "PP-D-1" } };
    expect(parseEvent(body)).toMatchObject({ ok: true, value: { kind: "other", eventType: "CUSTOMER.DISPUTE.CREATED", resourceId: "PP-D-1" } });
  });

  it("rejects bodies that are not events", () => {
    expect(parseEvent("{nope")).toEqual({ ok: false, error: "invalid_json" });
    expect(parseEvent({ id: "x" })).toEqual({ ok: false, error: "invalid_event" });
    expect(parseEvent({ ...refunded, resource: { status: "COMPLETED" } })).toEqual({ ok: false, error: "invalid_event" });
  });

  it("understands every event the fake emits", async () => {
    const s = setup();
    const orderId = await approvedOrder(s);
    const cap = await captureOrder({ orderId }, s.client);
    if (!cap.ok) throw new Error("capture");
    await refundCapture({ captureId: cap.value.captureId, amountCents: 100, currency: "EUR", reason: "x", requestId: "r" }, s.client);
    const payout = await createPayout({ senderBatchId: "p", items: [{ receiver: "a@b.c", amountCents: 100, currency: "EUR", note: "", senderItemId: "p" }] }, s.client);
    if (payout.ok) s.fake.setPayoutItemStatus(payout.value.items[0]!.payoutItemId!, "UNCLAIMED");
    const inv = await createAndSendInvoice({ recipientEmail: "a@b.c", recipientName: "A", items: [{ name: "x", amountCents: 100 }], currency: "EUR", note: "", reference: "R", requestId: "i" }, s.client);
    if (inv.ok) s.fake.payInvoice(inv.value.invoiceId);

    const kinds = s.fake.events.map((e) => {
      const p = parseEvent(JSON.stringify(e));
      return p.ok ? `${p.value.eventType}:${p.value.kind}` : `${e.event_type}:${p.error}`;
    });
    expect(kinds).toEqual([
      "CHECKOUT.ORDER.APPROVED:order",
      "PAYMENT.CAPTURE.COMPLETED:capture",
      "PAYMENT.CAPTURE.REFUNDED:refund",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED:payout_item",
      "PAYMENT.PAYOUTSBATCH.SUCCESS:payout_batch",
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED:payout_item",
      "INVOICING.INVOICE.PAID:invoice_paid",
    ]);
  });
});

const headers = new Headers({
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "PAYPAL-TRANSMISSION-ID": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "PAYPAL-TRANSMISSION-SIG": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "PAYPAL-TRANSMISSION-TIME": "2026-10-27T18:41:16Z",
});

describe("verifyWebhook", () => {
  it("posts the headers, webhook id and the raw event verbatim, and trusts only SUCCESS", async () => {
    const s = setup();
    // Odd spacing and key order on purpose: the raw bytes must reach PayPal untouched.
    const raw = `{ "id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"27M47624FP291604U","status":"COMPLETED"} }`;
    expect(await verifyWebhook({ headers, body: raw }, s.client)).toEqual({ ok: true, value: true });

    const call = s.posts()[0]!;
    expect(call.path).toBe("/v1/notifications/verify-webhook-signature");
    expect(call.headers["paypal-request-id"]).toBe("verify-69cd13f0-d67a-11e5-baa3-778b53f4ae55");
    expect(call.body).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: "2026-10-27T18:41:16Z",
      webhook_id: "WH-ID-1",
      webhook_event: JSON.parse(raw),
    });

    s.fake.failWebhookVerification(true);
    const forged = new Headers(headers);
    forged.set("paypal-transmission-id", "another-transmission");
    expect(await verifyWebhook({ headers: forged, body: raw }, s.client)).toEqual({ ok: true, value: false });
  });

  it("embeds the raw body byte for byte", async () => {
    const bodies: string[] = [];
    const fake = createFakePayPal();
    const client = createClient({
      fetch: async (input, init) => {
        if (String(input).endsWith("verify-webhook-signature")) bodies.push(String(init?.body));
        return fake.fetch(input, init);
      },
      env: ENV,
      now: Date.now,
    });
    const raw = `{"id":"WH-2","event_type":"X","resource":{"amount":{"value":"1.50"}},"unicode":"délai"}`;
    await verifyWebhook({ headers: Object.fromEntries(headers.entries()), body: raw }, client);
    expect(bodies[0]!.endsWith(`"webhook_event":${raw}}`)).toBe(true);
  });

  it("answers false without calling PayPal when headers are missing or the body is not JSON", async () => {
    const s = setup();
    const partial = new Headers(headers);
    partial.delete("paypal-transmission-sig");
    expect(await verifyWebhook({ headers: partial, body: "{}" }, s.client)).toEqual({ ok: true, value: false });
    expect(await verifyWebhook({ headers, body: "not json" }, s.client)).toEqual({ ok: true, value: false });
    expect(s.fake.requests).toHaveLength(0);
  });

  it("needs a webhook id", async () => {
    const s = setup({ ...ENV, PAYPAL_WEBHOOK_ID: undefined });
    expect(await verifyWebhook({ headers, body: "{}" }, s.client)).toMatchObject({ ok: false, error: { code: "auth" } });
  });
});
