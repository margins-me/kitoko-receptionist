import { describe, expect, it } from "vitest";
import { lookLabel, moneyIssue } from "../src/components/dashboard/model";
import type { CalBooking } from "../src/components/dashboard/model";

const booking = (patch: Partial<CalBooking>): CalBooking =>
  ({
    id: "b1",
    ref: "K7Q2ZP",
    staffId: "s1",
    staffName: "Aïcha",
    start: 0,
    end: 1,
    status: "confirmed",
    holdExpiresAt: null,
    displacedAt: null,
    movedFrom: null,
    clientName: "Giulia",
    serviceName: "Cornrows",
    priceCents: 4500,
    depositCents: 3000,
    feeCents: 150,
    balanceCents: 1500,
    balancePaid: false,
    currency: "EUR",
    language: "IT",
    source: "web",
    paymentStatus: "captured",
    paidCents: 3150,
    refundStatus: "none",
    refundedCents: 0,
    payoutStatus: null,
    payoutCents: null,
    ...patch,
  }) as CalBooking;

describe("money the pro must see", () => {
  it("flags refunds and payouts that did not go through", () => {
    expect(moneyIssue(booking({ status: "cancelled", refundStatus: "failed" }), true)).toBe("Refund failed");
    expect(moneyIssue(booking({ status: "cancelled", refundStatus: "pending" }), true)).toBe("Refund pending");
    expect(moneyIssue(booking({ status: "honoured", payoutStatus: "unclaimed" }), true)).toMatch(/^Payout unclaimed/);
    expect(moneyIssue(booking({ status: "honoured", payoutStatus: "failed" }), true)).toBe("Payout failed");
    expect(lookLabel(booking({ status: "cancelled", refundStatus: "failed" }))).toBe("Refund failed");
  });

  it("asks for a PayPal e-mail when a payout waits for one (Anta)", () => {
    expect(moneyIssue(booking({ status: "honoured", payoutStatus: "pending" }), false)).toBe("Payout waiting: add your PayPal e-mail");
    expect(moneyIssue(booking({ status: "honoured", payoutStatus: "pending" }), true)).toBeNull();
    expect(moneyIssue(booking({ status: "cancelled", refundStatus: "succeeded" }), true)).toBeNull();
  });
});
