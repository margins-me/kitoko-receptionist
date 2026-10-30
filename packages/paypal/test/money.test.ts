import { describe, expect, it } from "vitest";
import { centsToValue, fromMoney, money, valueToCents } from "../src/money";

describe("centsToValue", () => {
  it("formats integer cents as a two-decimal string", () => {
    expect(centsToValue(0)).toBe("0.00");
    expect(centsToValue(5)).toBe("0.05");
    expect(centsToValue(10)).toBe("0.10");
    expect(centsToValue(100)).toBe("1.00");
    expect(centsToValue(1230)).toBe("12.30");
    expect(centsToValue(1999)).toBe("19.99");
    expect(centsToValue(123456789)).toBe("1234567.89");
  });

  it("refuses negative, fractional and unsafe cents", () => {
    expect(() => centsToValue(-1)).toThrow(RangeError);
    expect(() => centsToValue(1.5)).toThrow(RangeError);
    expect(() => centsToValue(Number.NaN)).toThrow(RangeError);
    expect(() => centsToValue(2 ** 53)).toThrow(RangeError);
  });
});

describe("valueToCents", () => {
  it("parses PayPal values without float rounding", () => {
    expect(valueToCents("12.30")).toBe(1230);
    expect(valueToCents("12.3")).toBe(1230);
    expect(valueToCents("12")).toBe(1200);
    expect(valueToCents("0.07")).toBe(7);
    // 19.99 * 100 === 1998.9999999999998 and 1.15 * 100 === 114.99999999999999 in floats
    expect(valueToCents("19.99")).toBe(1999);
    expect(valueToCents("1.15")).toBe(115);
    expect(valueToCents(" 1.10 ")).toBe(110);
  });

  it("keeps the sign Reporting puts on refunds and payouts", () => {
    expect(valueToCents("-5.00")).toBe(-500);
    expect(valueToCents("-0.01")).toBe(-1);
  });

  it("rejects malformed values and more than two decimals", () => {
    for (const v of ["", "abc", "1.005", "1e3", ".5", "1.", "1,50", "+1.00", "NaN"]) expect(valueToCents(v)).toBeNull();
  });

  it("round-trips every cent value up to 1000.00", () => {
    for (let c = 0; c <= 100_000; c++) expect(valueToCents(centsToValue(c))).toBe(c);
  });
});

describe("money objects", () => {
  it("builds and reads PayPal money", () => {
    expect(money(3150, "EUR")).toEqual({ currency_code: "EUR", value: "31.50" });
    expect(fromMoney({ currency_code: "GBP", value: "45.00" })).toEqual({ cents: 4500, currency: "GBP" });
    // Payouts use `currency` instead of `currency_code`
    expect(fromMoney({ currency: "EUR", value: "9.87" })).toEqual({ cents: 987, currency: "EUR" });
  });

  it("returns null for other currencies or bad values", () => {
    expect(fromMoney({ currency_code: "USD", value: "1.00" })).toBeNull();
    expect(fromMoney({ currency_code: "EUR", value: "1.001" })).toBeNull();
    expect(fromMoney(undefined)).toBeNull();
  });
});
