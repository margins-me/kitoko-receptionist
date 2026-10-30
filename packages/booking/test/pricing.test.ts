import { describe, expect, it } from "vitest";
import { fromPrice, quote } from "../src/pricing";
import type { Selection, ServiceDef } from "../src/schemas";
import { box, knotless, nattes, withConditions } from "./fixtures";

const sel = (s: Partial<Selection> = {}): Selection => ({ options: {}, addons: [], conditionsAccepted: false, ...s });

const totals = (service: ServiceDef, s: Selection) => {
  const r = quote(service, s);
  return r.ok ? [r.value.priceCents, r.value.minutes] : r.error;
};

describe("quote", () => {
  it("prices knotless with defaults at 145 € for 6 h 15", () => {
    expect(totals(knotless, sel())).toEqual([14500, 375]);
  });

  it("adds explicit options and add-ons", () => {
    const s = sel({ options: { taille: "m", longueur: "mi-dos", meches: "incluses" }, addons: ["shampoing", "retrait"] });
    expect(totals(knotless, s)).toEqual([18000, 455]);
  });

  it("prices a service without options", () => {
    expect(totals(nattes, sel())).toEqual([4500, 90]);
  });

  it("builds lines with base first and group labels on options", () => {
    const r = quote(knotless, sel({ options: { taille: "s" }, addons: ["retrait"] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.lines).toEqual([
      { kind: "base", id: "knotless", label: { fr: "Knotless braids" }, priceCents: 8500, minutes: 240 },
      {
        kind: "option",
        id: "taille:s",
        label: { fr: "S, fines" },
        group: { fr: "Taille des tresses", en: "Braid size" },
        priceCents: 5500,
        minutes: 180,
      },
      {
        kind: "option",
        id: "longueur:mi-dos",
        label: { fr: "Mi-dos" },
        group: { fr: "Longueur", en: "Length" },
        priceCents: 2000,
        minutes: 45,
      },
      {
        kind: "option",
        id: "meches:incluses",
        label: { fr: "Mèches incluses" },
        group: { fr: "Mèches", en: "Hair" },
        priceCents: 1500,
        minutes: 0,
      },
      { kind: "addon", id: "retrait", label: { fr: "Retrait ancienne coiffure" }, priceCents: 2500, minutes: 60 },
    ]);
  });

  it("requires a choice for a group without default", () => {
    const service: ServiceDef = {
      ...nattes,
      optionGroups: [
        {
          id: "couleur",
          label: { fr: "Couleur" },
          options: [{ id: "noir", label: { fr: "Noir" }, priceCents: 0, minutes: 0 }],
        },
      ],
    };
    expect(totals(service, sel())).toBe("missing_option");
    expect(totals(service, sel({ options: { couleur: "noir" } }))).toEqual([4500, 90]);
  });

  it("rejects an unknown option", () => {
    expect(totals(knotless, sel({ options: { taille: "xl" } }))).toBe("unknown_option");
  });

  it("rejects an unknown group key", () => {
    expect(totals(knotless, sel({ options: { couleur: "noir" } }))).toBe("unknown_option");
  });

  it("rejects an unknown add-on", () => {
    expect(totals(knotless, sel({ addons: ["massage"] }))).toBe("unknown_addon");
  });

  it("counts an add-on listed twice once, in service order", () => {
    const r = quote(knotless, sel({ addons: ["retrait", "shampoing", "retrait"] }));
    if (!r.ok) throw new Error(r.error);
    expect([r.value.priceCents, r.value.minutes]).toEqual([18000, 455]);
    expect(r.value.lines.filter((l) => l.kind === "addon").map((l) => l.id)).toEqual(["shampoing", "retrait"]);
  });

  it("enforces conditions", () => {
    expect(totals(withConditions, sel())).toBe("conditions_not_accepted");
    expect(totals(withConditions, sel({ conditionsAccepted: true }))).toEqual([4500, 90]);
  });

  it("rejects a negative total", () => {
    const service: ServiceDef = {
      ...nattes,
      optionGroups: [
        {
          id: "remise",
          label: { fr: "Remise" },
          default: "grosse",
          options: [{ id: "grosse", label: { fr: "Grosse remise" }, priceCents: -5000, minutes: 0 }],
        },
      ],
    };
    expect(totals(service, sel())).toBe("invalid_total");
  });
});

describe("fromPrice", () => {
  it("gives the cheapest price and the duration range, add-ons excluded", () => {
    expect(fromPrice(knotless)).toEqual({ priceCents: 8500, minMinutes: 240, maxMinutes: 510 });
    expect(fromPrice(box)).toEqual({ priceCents: 7500, minMinutes: 225, maxMinutes: 480 });
    expect(fromPrice(nattes)).toEqual({ priceCents: 4500, minMinutes: 90, maxMinutes: 90 });
  });
});
