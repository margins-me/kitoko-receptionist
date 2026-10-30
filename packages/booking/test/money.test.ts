import { describe, expect, it } from "vitest";
import { balanceDue, bookingFee, checkoutAmounts, depositDue, MINIMUM_CENTS, promoDiscount, promoQuote } from "../src/money";

describe("depositDue", () => {
  it("applies each rule", () => {
    expect(depositDue(18000, { mode: "fixed", cents: 3000 })).toBe(3000);
    expect(depositDue(2000, { mode: "fixed", cents: 3000 })).toBe(2000);
    expect(depositDue(15555, { mode: "percent", percent: 30 })).toBe(4667);
    expect(depositDue(15555, { mode: "percent", percent: 100 })).toBe(15555);
    expect(depositDue(15555, { mode: "full" })).toBe(15555);
    expect(depositDue(15555, { mode: "none" })).toBe(0);
  });
});

describe("bookingFee", () => {
  it.each([
    [0, 0],
    [1, 150],
    [5000, 150],
    [5001, 250],
    [10000, 250],
    [10001, 390],
    [20000, 390],
    [20001, 550],
    [30000, 550],
    [30001, 550],
  ])("%i cents online → %i", (online, fee) => {
    expect(bookingFee(online)).toBe(fee);
  });
});

describe("checkoutAmounts", () => {
  const amounts = { serviceCents: 3000, productsCents: 1800, deliveryCents: 0 };

  it("adds the fee on top when the client pays it", () => {
    expect(checkoutAmounts({ ...amounts, feePayer: "client" })).toEqual({
      ok: true,
      value: { baseCents: 4800, feeCents: 150, chargeCents: 4950, platformFeeCents: 150, proReceivesCents: 4800 },
    });
  });

  it("takes the fee from the pro when she absorbs it", () => {
    expect(checkoutAmounts({ ...amounts, feePayer: "pro" })).toEqual({
      ok: true,
      value: { baseCents: 4800, feeCents: 150, chargeCents: 4800, platformFeeCents: 150, proReceivesCents: 4650 },
    });
  });

  it("computes the fee on products and delivery too", () => {
    const r = checkoutAmounts({ serviceCents: 0, productsCents: 4600, deliveryCents: 490, feePayer: "client" });
    expect(r.ok && r.value.feeCents).toBe(250);
  });

  it("refuses a pro-absorbed checkout that would not cover the fee", () => {
    const r = checkoutAmounts({ serviceCents: 100, productsCents: 0, deliveryCents: 0, feePayer: "pro" });
    expect(r).toEqual({ ok: false, error: "below_fee" });
  });

  it("never charges less than the minimum online", () => {
    const r = checkoutAmounts({ serviceCents: 1, productsCents: 0, deliveryCents: 0, feePayer: "client" });
    expect(r.ok && r.value.chargeCents).toBeGreaterThanOrEqual(MINIMUM_CENTS);
  });

  it("returns zeros for an empty checkout", () => {
    const r = checkoutAmounts({ serviceCents: 0, productsCents: 0, deliveryCents: 0, feePayer: "pro" });
    expect(r).toEqual({
      ok: true,
      value: { baseCents: 0, feeCents: 0, chargeCents: 0, platformFeeCents: 0, proReceivesCents: 0 },
    });
  });
});

describe("balanceDue", () => {
  it("is the price minus what was paid, never negative", () => {
    expect(balanceDue(18000, 3000)).toBe(15000);
    expect(balanceDue(18000, 20000)).toBe(0);
  });
});

describe("promoDiscount", () => {
  it("takes a rounded percent off the price", () => {
    expect(promoDiscount(15555, { percent: 10, cents: null })).toBe(1556);
    expect(promoDiscount(15555, { percent: 100, cents: null })).toBe(15555);
  });

  it("takes a fixed amount off, never more than the price", () => {
    expect(promoDiscount(6000, { percent: null, cents: 1000 })).toBe(1000);
    expect(promoDiscount(800, { percent: null, cents: 1000 })).toBe(800);
  });
});

describe("promoQuote", () => {
  const base = { listPriceCents: 10000, feePayer: "client" as const };

  it("recomputes a percent deposit on the discounted price", () => {
    const r = promoQuote({ ...base, promo: { percent: 20, cents: null }, deposit: { mode: "percent", percent: 30 } });
    expect(r).toEqual({ ok: true, value: { priceCents: 8000, depositCents: 2400, discountCents: 2000 } });
  });

  it("keeps a fixed deposit while the price still covers it", () => {
    const fixed = { mode: "fixed", cents: 3000 } as const;
    expect(promoQuote({ ...base, promo: { percent: null, cents: 1500 }, deposit: fixed })).toEqual({
      ok: true,
      value: { priceCents: 8500, depositCents: 3000, discountCents: 1500 },
    });
    expect(promoQuote({ ...base, promo: { percent: null, cents: 8000 }, deposit: fixed })).toEqual({
      ok: true,
      value: { priceCents: 2000, depositCents: 2000, discountCents: 8000 },
    });
  });

  it("charges the whole discounted price in full mode", () => {
    const r = promoQuote({ ...base, promo: { percent: 50, cents: null }, deposit: { mode: "full" } });
    expect(r).toEqual({ ok: true, value: { priceCents: 5000, depositCents: 5000, discountCents: 5000 } });
  });

  it("only lowers the rest on site without a deposit (and pay-on-site)", () => {
    const r = promoQuote({ ...base, promo: { percent: 10, cents: null }, deposit: { mode: "none" } });
    expect(r).toEqual({ ok: true, value: { priceCents: 9000, depositCents: 0, discountCents: 1000 } });
  });

  it("makes a 100 % code free, with nothing to pay online", () => {
    const r = promoQuote({ ...base, promo: { percent: 100, cents: null }, deposit: { mode: "full" } });
    expect(r).toEqual({ ok: true, value: { priceCents: 0, depositCents: 0, discountCents: 10000 } });
  });

  it("removes the discount without a code", () => {
    const r = promoQuote({ ...base, promo: null, deposit: { mode: "percent", percent: 30 } });
    expect(r).toEqual({ ok: true, value: { priceCents: 10000, depositCents: 3000, discountCents: 0 } });
  });

  it("refuses a deposit left too small to cover the fee the pro absorbs", () => {
    const r = promoQuote({
      listPriceCents: 1000,
      feePayer: "pro",
      promo: { percent: 90, cents: null },
      deposit: { mode: "full" },
    });
    expect(r).toEqual({ ok: false, error: "below_fee" });
  });
});
