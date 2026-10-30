import { describe, expect, it } from "vitest";
import { bookingFacts } from "../src/facts";
import type { DepositRule, Rules } from "../src/schemas";

const rules = (deposit: DepositRule): Rules => ({
  deposit,
  feePayer: "client",
  reschedule: { maxCount: 1, minHoursBefore: 48 },
  cancellation: [{ minHoursBefore: 0, keepPercent: 100 }],
  lateness: { graceMinutes: 10, feeCents: null, autoCancelAfterMinutes: null },
  balanceMethods: ["cash"],
  companionsAllowed: true,
  extra: [],
});
const own = (deposit: DepositRule | null = null) => ({ deposit });

describe("booking facts under her name", () => {
  it("says nothing without a service online", () => {
    expect(bookingFacts([], rules({ mode: "fixed", cents: 2000 }), true)).toEqual([]);
  });

  it("books at any hour with instant confirmation, and an online deposit when every service takes one", () => {
    expect(bookingFacts([own(), own()], rules({ mode: "fixed", cents: 2000 }), true)).toEqual(["anytime", "instant", "deposit"]);
    expect(bookingFacts([own(), own({ mode: "percent", percent: 30 })], rules({ mode: "fixed", cents: 2000 }), true)).toEqual([
      "anytime",
      "instant",
      "deposit",
    ]);
  });

  it("says paid online when some service is paid in full", () => {
    expect(bookingFacts([own(), own({ mode: "full" })], rules({ mode: "fixed", cents: 2000 }), true)).toEqual(["anytime", "instant", "payment"]);
  });

  it("promises no online payment while her payments are off, nor with a free service", () => {
    expect(bookingFacts([own()], rules({ mode: "fixed", cents: 2000 }), false)).toEqual(["anytime", "instant"]);
    expect(bookingFacts([own(), own({ mode: "none" })], rules({ mode: "fixed", cents: 2000 }), true)).toEqual(["anytime", "instant"]);
  });
});
