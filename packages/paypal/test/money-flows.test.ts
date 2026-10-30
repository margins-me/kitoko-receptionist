import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client";
import { createAndSendInvoice } from "../src/invoices";
import { captureOrder } from "../src/orders";
import { createPayout, getPayoutBatch, getPayoutItem } from "../src/payouts";
import { getRefund, refundCapture } from "../src/refunds";
import { listTransactions } from "../src/reporting";
import { ENV, approvedOrder, orderInput, setup } from "./helpers";

async function capturedOrder(s: ReturnType<typeof setup>) {
  const orderId = await approvedOrder(s);
  const c = await captureOrder({ orderId }, s.client);
  if (!c.ok) throw new Error(c.error.message);
  return c.value;
}

describe("refundCapture", () => {
  it("short-circuits seeded captures without any HTTP call", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("no network in seeds")));
    const client = createClient({ fetch: fetch as unknown as typeof globalThis.fetch, env: ENV, now: Date.now });
    const res = await refundCapture({ captureId: "SEED-CAP-0001", amountCents: 3000, currency: "EUR", reason: "Annulation", requestId: "refund-9" }, client);
    expect(res).toEqual({
      ok: true,
      value: { refundId: "SEED-R-refund-9", status: "COMPLETED", amountCents: 3000, currency: "EUR", captureId: "SEED-CAP-0001", synthetic: true },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await getRefund("SEED-R-refund-9", client)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("refunds part of a capture with note_to_payer and reads it back", async () => {
    const s = setup();
    const cap = await capturedOrder(s);
    const res = await refundCapture({ captureId: cap.captureId, amountCents: 3000, currency: "EUR", reason: "Annulation dans le délai gratuit", requestId: "refund-1" }, s.client);
    expect(res).toEqual({
      ok: true,
      value: { refundId: expect.stringMatching(/^FKREF/), status: "COMPLETED", amountCents: 3000, currency: "EUR", captureId: cap.captureId, synthetic: false },
    });
    const post = s.posts().at(-1)!;
    expect(post.body).toEqual({ amount: { currency_code: "EUR", value: "30.00" }, note_to_payer: "Annulation dans le délai gratuit" });
    if (!res.ok) return;
    const again = await getRefund(res.value.refundId, s.client);
    expect(again.ok && again.value).toMatchObject({ amountCents: 3000, captureId: cap.captureId });
  });

  it("maps a refund above what is left to unprocessable", async () => {
    const s = setup();
    const cap = await capturedOrder(s);
    await refundCapture({ captureId: cap.captureId, amountCents: 3000, currency: "EUR", reason: "x", requestId: "r1" }, s.client);
    const res = await refundCapture({ captureId: cap.captureId, amountCents: 200, currency: "EUR", reason: "x", requestId: "r2" }, s.client);
    expect(res).toMatchObject({ ok: false, error: { code: "unprocessable", issue: "REFUND_AMOUNT_EXCEEDED" } });
  });
});

describe("payouts", () => {
  it("creates an EMAIL payout and maps sender items to PayPal item ids", async () => {
    const s = setup();
    const res = await createPayout(
      {
        senderBatchId: "payout-row-1",
        items: [{ receiver: "amara@example.com", amountCents: 3000, currency: "EUR", note: "Booking K7Q2ZP", senderItemId: "payout-row-1" }],
      },
      s.client,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      payoutBatchId: expect.stringMatching(/^FKBATCH/),
      status: "SUCCESS",
      items: [{ senderItemId: "payout-row-1", payoutItemId: expect.stringMatching(/^FKITEM/), status: "SUCCESS" }],
    });
    const post = s.posts()[0]!;
    expect(post.headers["paypal-request-id"]).toBe("payout-row-1");
    expect(post.body).toMatchObject({
      sender_batch_header: { sender_batch_id: "payout-row-1", recipient_type: "EMAIL" },
      items: [{ recipient_type: "EMAIL", receiver: "amara@example.com", amount: { value: "30.00", currency: "EUR" }, note: "Booking K7Q2ZP", sender_item_id: "payout-row-1" }],
    });

    const item = await getPayoutItem(res.value.items[0]!.payoutItemId!, s.client);
    expect(item.ok && item.value).toMatchObject({ status: "SUCCESS", amountCents: 3000, currency: "EUR", senderItemId: "payout-row-1", receiver: "amara@example.com" });

    s.fake.setPayoutItemStatus(res.value.items[0]!.payoutItemId!, "UNCLAIMED");
    const batch = await getPayoutBatch(res.value.payoutBatchId, s.client);
    expect(batch.ok && batch.value.items[0]!.status).toBe("UNCLAIMED");
  });

  it("refuses an empty batch or a bad amount without calling PayPal", async () => {
    const s = setup();
    expect((await createPayout({ senderBatchId: "b", items: [] }, s.client)).ok).toBe(false);
    expect((await createPayout({ senderBatchId: "b", items: [{ receiver: "a@b.c", amountCents: -1, currency: "EUR", note: "", senderItemId: "i" }] }, s.client)).ok).toBe(false);
    expect(s.fake.requests).toHaveLength(0);
  });
});

describe("invoices", () => {
  it("drafts and sends a due-on-receipt invoice without tips and returns the payer link", async () => {
    const s = setup();
    const res = await createAndSendInvoice(
      {
        recipientEmail: "awa@example.com",
        recipientName: "Awa Diallo Ba",
        items: [{ name: "Solde : box braids", amountCents: 9000 }],
        currency: "GBP",
        note: "Merci pour votre visite",
        reference: "K7Q2ZP",
        requestId: "action-1",
      },
      s.client,
    );
    expect(res).toEqual({
      ok: true,
      value: { invoiceId: expect.stringMatching(/^INV2-FAKE-/), status: "SENT", payerViewUrl: expect.stringMatching(/^https:\/\/www\.sandbox\.paypal\.com\/invoice\/p\/#INV2-FAKE-/) },
    });
    const [create, send] = s.posts();
    expect(create!.headers.prefer).toBe("return=representation");
    expect(create!.body).toEqual({
      detail: { currency_code: "GBP", reference: "K7Q2ZP", note: "Merci pour votre visite", payment_term: { term_type: "DUE_ON_RECEIPT" } },
      primary_recipients: [{ billing_info: { name: { given_name: "Awa", surname: "Diallo Ba" }, email_address: "awa@example.com" } }],
      items: [{ name: "Solde : box braids", quantity: "1", unit_amount: { currency_code: "GBP", value: "90.00" }, unit_of_measure: "AMOUNT" }],
      configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false }, tax_calculated_after_discount: true },
    });
    expect(send!.body).toEqual({ send_to_recipient: true, send_to_invoicer: false });
    expect(send!.headers["paypal-request-id"]).toBe("action-1-send");
  });

  it("is safe to retry: the same request id reuses the draft and the send", async () => {
    const s = setup();
    const input = { recipientEmail: "a@example.com", recipientName: "A", items: [{ name: "Solde", amountCents: 100 }], currency: "EUR" as const, note: "", reference: "R", requestId: "action-2" };
    const a = await createAndSendInvoice(input, s.client);
    const b = await createAndSendInvoice(input, s.client);
    expect(a.ok && b.ok && a.value.invoiceId === b.value.invoiceId).toBe(true);
  });
});

describe("reporting", () => {
  it("lists normalized rows with signed cents and our booking id", async () => {
    const s = setup();
    const cap = await capturedOrder(s);
    await refundCapture({ captureId: cap.captureId, amountCents: 3000, currency: "EUR", reason: "x", requestId: "r1" }, s.client);
    const res = await listTransactions({ start: "2026-10-01T00:00:00Z", end: new Date("2026-10-28T00:00:00Z") }, s.client);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rows).toEqual([
      expect.objectContaining({ eventCode: "T0006", status: "S", amountCents: 3150, currency: "EUR", customId: orderInput.bookingId }),
      expect.objectContaining({ eventCode: "T1107", amountCents: -3000, referenceId: cap.captureId }),
    ]);
    expect(res.value.lastRefreshed).toBe("2026-10-27T10:00:00Z");
    const url = new URL(s.fake.requests.at(-1)!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start_date: "2026-10-01T00:00:00Z",
      end_date: "2026-10-28T00:00:00Z",
      fields: "all",
      page_size: "500",
      page: "1",
    });
  });

  it("refuses ranges over 31 days before calling PayPal", async () => {
    const s = setup();
    const res = await listTransactions({ start: "2026-09-01T00:00:00Z", end: "2026-10-27T00:00:00Z" }, s.client);
    expect(res).toMatchObject({ ok: false, error: { code: "unprocessable" } });
    expect(s.fake.requests).toHaveLength(0);
  });
});
