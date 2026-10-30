import { describe, expect, it } from "vitest";
import { bookingMoney, isSeedCapture, oneOf, toPayment, toPayout, toRefund } from "../src/rows";
import type { PaymentRow, PayoutRow, RefundRow } from "../src/rows";

const paymentRow = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "p1",
  pro_id: "pro",
  booking_id: "b1",
  kind: "deposit",
  status: "captured",
  paypal_order_id: "ORDER-1",
  capture_id: "CAP-1",
  deposit_cents: 3000,
  fee_cents: 150,
  amount_cents: 3150,
  refunded_cents: 0,
  currency: "EUR",
  payer: { name: { given_name: "Ada" } },
  captured_at: "2030-01-07T10:00:00+00:00",
  created_at: "2030-01-07T09:59:00+00:00",
  ...over,
});

const refundRow = (over: Partial<RefundRow> = {}): RefundRow => ({
  id: "r1",
  pro_id: "pro",
  payment_id: "p1",
  booking_id: "b1",
  amount_cents: 3000,
  currency: "EUR",
  reason: "client_cancel",
  status: "pending",
  paypal_refund_id: null,
  created_at: "2030-01-08T10:00:00+00:00",
  ...over,
});

const payoutRow = (over: Partial<PayoutRow> = {}): PayoutRow => ({
  id: "o1",
  pro_id: "pro",
  booking_id: "b1",
  amount_cents: 3000,
  fee_cents: 150,
  currency: "GBP",
  reason: "honoured",
  status: "pending",
  payout_batch_id: null,
  payout_item_id: null,
  created_at: "2030-01-08T10:00:00+00:00",
  ...over,
});

describe("row mappers", () => {
  it("maps a payment", () => {
    expect(toPayment(paymentRow())).toEqual({
      id: "p1",
      proId: "pro",
      bookingId: "b1",
      kind: "deposit",
      status: "captured",
      paypalOrderId: "ORDER-1",
      captureId: "CAP-1",
      depositCents: 3000,
      feeCents: 150,
      amountCents: 3150,
      refundedCents: 0,
      currency: "EUR",
      payer: { name: { given_name: "Ada" } },
      capturedAt: Date.UTC(2030, 0, 7, 10),
      createdAt: Date.UTC(2030, 0, 7, 9, 59),
    });
  });

  it("refuses values outside the CHECK constraints", () => {
    expect(() => toPayment(paymentRow({ status: "succeeded" }))).toThrow(/Unexpected value "succeeded"/);
    expect(() => toPayout(payoutRow({ currency: "USD" }))).toThrow();
    expect(() => oneOf(["a", "b"], "c")).toThrow();
  });

  it("maps refunds and payouts", () => {
    expect(toRefund(refundRow())).toMatchObject({ amountCents: 3000, status: "pending", reason: "client_cancel", paypalRefundId: null });
    expect(toPayout(payoutRow())).toMatchObject({ amountCents: 3000, feeCents: 150, currency: "GBP", reason: "honoured" });
  });
});

describe("bookingMoney", () => {
  it("is all zeros before payment", () => {
    expect(bookingMoney([toPayment(paymentRow({ status: "created", capture_id: null }))], [], [])).toEqual({
      paidCents: 0,
      refundedCents: 0,
      refundPending: false,
      payoutCents: null,
      payoutStatus: null,
      captureId: null,
    });
  });

  it("sums what was captured, refunded (not failed) and paid out", () => {
    const money = bookingMoney(
      [toPayment(paymentRow()), toPayment(paymentRow({ id: "p2", status: "denied", capture_id: null }))],
      [toRefund(refundRow({ amount_cents: 1000, status: "succeeded" })), toRefund(refundRow({ id: "r2", amount_cents: 500, status: "failed" })), toRefund(refundRow({ id: "r3", amount_cents: 200 }))],
      [toPayout(payoutRow({ amount_cents: 2000, status: "sent" }))],
    );
    expect(money).toEqual({
      paidCents: 3150,
      refundedCents: 1200,
      refundPending: true,
      payoutCents: 2000,
      payoutStatus: "sent",
      captureId: "CAP-1",
    });
  });
});

describe("isSeedCapture", () => {
  it("spots seeded captures", () => {
    expect(isSeedCapture("SEED-ABC234")).toBe(true);
    expect(isSeedCapture("8MC585209K746392H")).toBe(false);
    expect(isSeedCapture(null)).toBe(false);
  });
});
