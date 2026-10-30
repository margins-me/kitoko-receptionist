import { describe, expect, it } from "vitest";
import { effectiveDepositRule, effectiveRules } from "../src/deposit-rule";
import { rulesText } from "../src/rules-text";
import { rules } from "./fixtures";

describe("deposit while payments are off", () => {
  it("uses the service override, else the pro rule, when payments are enabled", () => {
    expect(effectiveDepositRule(null, rules, true)).toEqual({ mode: "fixed", cents: 3000 });
    expect(effectiveDepositRule({ mode: "percent", percent: 30 }, rules, true)).toEqual({ mode: "percent", percent: 30 });
  });

  it("asks for no deposit before payment onboarding", () => {
    expect(effectiveDepositRule({ mode: "full" }, rules, false)).toEqual({ mode: "none" });
    expect(effectiveRules(rules, false).deposit).toEqual({ mode: "none" });
    expect(effectiveRules(rules, true)).toBe(rules);
  });

  it("drops the deposit sentence from the rules the client reads", () => {
    expect(rulesText(effectiveRules(rules, false), "fr", "EUR").some((s) => s.startsWith("Acompte"))).toBe(false);
    expect(rulesText(rules, "fr", "EUR")[0]).toBe("Acompte de 30 €, déduit du prix final.");
  });
});
