import type { Rules } from "../src/schemas";
import { describe, expect, it } from "vitest";
import { normaliseTiers, rulesText } from "../src/rules-text";


// The seeded Nala rules.
const base: Rules = {
  deposit: { mode: "fixed", cents: 3000 },
  feePayer: "client",
  reschedule: { maxCount: 1, minHoursBefore: 48 },
  cancellation: [
    { minHoursBefore: 48, keepPercent: 0 },
    { minHoursBefore: 0, keepPercent: 100 },
  ],
  lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: null },
  balanceMethods: ["cash"],
  companionsAllowed: false,
  extra: [],
};

const with_ = (patch: Partial<Rules>): Rules => ({ ...base, ...patch });
const nb = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("rulesText", () => {
  it("writes the default rules in French", () => {
    expect(rulesText(base, "fr", "EUR").map(nb)).toEqual([
      "Acompte de 30 €, déduit du prix final.",
      "Report gratuit une fois, jusqu’à 48 h avant.",
      "Annulation gratuite jusqu’à 48 h avant ; ensuite l’acompte est gardé.",
      "15 minutes de retard maximum.",
      "Viens seule, sans accompagnant.",
    ]);
  });

  it("writes the default rules in English", () => {
    expect(rulesText(base, "en", "EUR").map(nb)).toEqual([
      "€30 deposit, deducted from the final price.",
      "Free rescheduling once, up to 48 h before.",
      "Free cancellation up to 48 h before; after that the deposit is kept.",
      "15 minutes late at most.",
      "Come alone, without a companion.",
    ]);
  });

  describe("deposit", () => {
    it("states a percent deposit", () => {
      expect(nb(rulesText(with_({ deposit: { mode: "percent", percent: 30 } }), "fr", "EUR")[0]!)).toBe("Acompte de 30 % du prix, déduit du prix final.");
    });

    it("states a full payment and talks about the amount paid", () => {
      const rules = with_({
        deposit: { mode: "full" },
        cancellation: [
          { minHoursBefore: 48, keepPercent: 0 },
          { minHoursBefore: 24, keepPercent: 50 },
          { minHoursBefore: 0, keepPercent: 100 },
        ],
      });
      expect(rulesText(rules, "fr", "EUR").map(nb)).toEqual([
        "Paiement complet en ligne à la réservation.",
        "Report gratuit une fois, jusqu’à 48 h avant.",
        "Annulation gratuite jusqu’à 48 h avant.",
        "Entre 24 h et 48 h avant : 50 % du montant payé est gardé.",
        "Moins de 24 h avant : le montant payé est gardé.",
        "15 minutes de retard maximum.",
        "Viens seule, sans accompagnant.",
      ]);
    });

    it("says nothing about deposit or cancellation when nothing is paid online", () => {
      expect(rulesText(with_({ deposit: { mode: "none" } }), "fr", "EUR").map(nb)).toEqual([
        "Report gratuit une fois, jusqu’à 48 h avant.",
        "15 minutes de retard maximum.",
        "Viens seule, sans accompagnant.",
      ]);
    });
  });

  describe("reschedule", () => {
    it("says when rescheduling is not possible", () => {
      expect(rulesText(with_({ reschedule: { maxCount: 0, minHoursBefore: 48 } }), "fr", "EUR")[1]).toBe("Pas de report possible.");
      expect(rulesText(with_({ reschedule: { maxCount: 0, minHoursBefore: 48 } }), "en", "EUR")[1]).toBe("No rescheduling.");
    });

    it("uses the count and notice from the settings", () => {
      expect(nb(rulesText(with_({ reschedule: { maxCount: 2, minHoursBefore: 72 } }), "fr", "EUR")[1]!)).toBe("Report gratuit jusqu’à 2 fois, jusqu’à 72 h avant.");
      expect(nb(rulesText(with_({ reschedule: { maxCount: 2, minHoursBefore: 72 } }), "en", "EUR")[1]!)).toBe("Free rescheduling up to 2 times, up to 72 h before.");
      expect(rulesText(with_({ reschedule: { maxCount: 1, minHoursBefore: 0 } }), "fr", "EUR")[1]).toBe("Report gratuit une fois, jusqu’au début du rendez-vous.");
    });
  });

  describe("cancellation", () => {
    it("sorts tiers and describes a middle tier", () => {
      const rules = with_({
        cancellation: [
          { minHoursBefore: 0, keepPercent: 100 },
          { minHoursBefore: 48, keepPercent: 0 },
          { minHoursBefore: 24, keepPercent: 50 },
        ],
      });
      expect(rulesText(rules, "fr", "EUR").slice(2, 5).map(nb)).toEqual([
        "Annulation gratuite jusqu’à 48 h avant.",
        "Entre 24 h et 48 h avant : 50 % de l’acompte est gardé.",
        "Moins de 24 h avant : l’acompte est gardé.",
      ]);
      expect(rulesText(rules, "en", "EUR").slice(2, 5).map(nb)).toEqual([
        "Free cancellation up to 48 h before.",
        "Between 24 h and 48 h before: 50% of the deposit is kept.",
        "Less than 24 h before: the deposit is kept.",
      ]);
    });

    it("treats a missing 0 h tier as keeping everything", () => {
      expect(normaliseTiers([{ minHoursBefore: 48, keepPercent: 0 }])).toEqual([
        { minHoursBefore: 48, keepPercent: 0 },
        { minHoursBefore: 0, keepPercent: 100 },
      ]);
      expect(nb(rulesText(with_({ cancellation: [{ minHoursBefore: 48, keepPercent: 0 }] }), "fr", "EUR")[2]!)).toBe(
        "Annulation gratuite jusqu’à 48 h avant ; ensuite l’acompte est gardé.",
      );
    });

    it("handles a single tier", () => {
      expect(rulesText(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 0 }] }), "fr", "EUR")[2]).toBe("Annulation gratuite à tout moment.");
      expect(rulesText(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 100 }] }), "fr", "EUR")[2]).toBe("En cas d’annulation, l’acompte est gardé.");
      expect(nb(rulesText(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 50 }] }), "en", "EUR")[2]!)).toBe("If you cancel, 50% of the deposit is kept.");
    });

    it("handles tiers without a free period", () => {
      const rules = with_({
        cancellation: [
          { minHoursBefore: 24, keepPercent: 50 },
          { minHoursBefore: 0, keepPercent: 100 },
        ],
      });
      expect(rulesText(rules, "fr", "EUR").slice(2, 4).map(nb)).toEqual([
        "Plus de 24 h avant : 50 % de l’acompte est gardé.",
        "Moins de 24 h avant : l’acompte est gardé.",
      ]);
    });
  });

  describe("lateness", () => {
    it("adds the fee and auto-cancel sentences when set", () => {
      const rules = with_({ lateness: { graceMinutes: 15, feeCents: 1000, autoCancelAfterMinutes: 30 } });
      expect(rulesText(rules, "fr", "EUR").slice(3, 6).map(nb)).toEqual([
        "15 minutes de retard maximum.",
        "Au-delà, 10 € de frais de retard.",
        "Au-delà de 30 minutes de retard, ta pro peut annuler le rendez-vous.",
      ]);
      expect(rulesText(rules, "en", "EUR").slice(3, 6).map(nb)).toEqual([
        "15 minutes late at most.",
        "Beyond that, a €10 late fee applies.",
        "Beyond 30 minutes late, your pro may cancel the appointment.",
      ]);
    });

    it("shortens auto-cancel when it starts with the grace period", () => {
      const rules = with_({ lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: 15 } });
      expect(rulesText(rules, "fr", "EUR")[4]).toBe("Au-delà, ta pro peut annuler le rendez-vous.");
    });

    it("says when no lateness is accepted", () => {
      expect(rulesText(with_({ lateness: { graceMinutes: 0, feeCents: null, autoCancelAfterMinutes: null } }), "fr", "EUR")[3]).toBe("Pas de retard accepté.");
    });
  });

  it("drops the companions sentence when companions are allowed", () => {
    expect(rulesText(with_({ companionsAllowed: true }), "fr", "EUR")).not.toContain("Viens seule, sans accompagnant.");
  });

  it("appends extra rules, English falling back to French", () => {
    const rules = with_({
      extra: [{ fr: "Cheveux lavés, démêlés et secs.", en: "Hair washed and dry." }, { fr: "Pas d’enfants." }],
    });
    expect(rulesText(rules, "fr", "EUR").slice(-2)).toEqual(["Cheveux lavés, démêlés et secs.", "Pas d’enfants."]);
    expect(rulesText(rules, "en", "EUR").slice(-2)).toEqual(["Hair washed and dry.", "Pas d’enfants."]);
  });
});
