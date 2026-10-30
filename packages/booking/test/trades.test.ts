import { describe, expect, it } from "vitest";
import { hairOnly, isTrade, TRADE_KINDS, TRADES } from "../src/trades";

describe("trades", () => {
  it("knows each setup trade, and nothing else", () => {
    for (const trade of TRADES) expect(isTrade(trade)).toBe(true);
    expect(isTrade("barbier")).toBe(false);
    expect(isTrade("")).toBe(false);
    expect(isTrade(null)).toBe(false);
  });

  it("counts coiffure and perruques as hair, not the beauty trades", () => {
    expect(TRADE_KINDS.coiffure).toBe("hair");
    expect(TRADE_KINDS.perruques).toBe("hair");
    for (const trade of ["visage", "massage", "maquillage", "ongles", "cils"] as const) expect(TRADE_KINDS[trade]).toBe("other");
  });

  it("titles the flow for hair only when every trade she has is hair", () => {
    expect(hairOnly(["tresses", "locks", "perruques"])).toBe(true);
    expect(hairOnly(["coiffure", "maquillage"])).toBe(false);
    expect(hairOnly(["visage", "massage"])).toBe(false);
    expect(hairOnly(["tresses", "unknown-trade"])).toBe(false);
    expect(hairOnly(["barbier"])).toBe(false);
    expect(hairOnly([])).toBe(false);
  });
});
