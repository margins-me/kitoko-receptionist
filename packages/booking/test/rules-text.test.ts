import { describe, expect, it } from "vitest";
import { cancellationSummary, rulesText } from "../src/rules-text";
import type { Rules } from "../src/schemas";

// French and English are covered in rules-text-fr-en.test.ts; these are the Italian and Spanish sentences, and pounds.

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
const nb = (s: string) => s.replace(/[  ]/g, " ");
const text = (rules: Rules, locale: "it" | "es") => rulesText(rules, locale, "EUR").map(nb);

const fullPayment = with_({
  deposit: { mode: "full" },
  cancellation: [
    { minHoursBefore: 48, keepPercent: 0 },
    { minHoursBefore: 24, keepPercent: 50 },
    { minHoursBefore: 0, keepPercent: 100 },
  ],
});
const middleTier = with_({
  cancellation: [
    { minHoursBefore: 0, keepPercent: 100 },
    { minHoursBefore: 48, keepPercent: 0 },
    { minHoursBefore: 24, keepPercent: 50 },
  ],
});
const noFreePeriod = with_({
  cancellation: [
    { minHoursBefore: 24, keepPercent: 50 },
    { minHoursBefore: 0, keepPercent: 100 },
  ],
});
const lateFee = with_({ lateness: { graceMinutes: 15, feeCents: 1000, autoCancelAfterMinutes: 30 } });

describe("rulesText in Italian", () => {
  it("writes the default rules", () => {
    expect(text(base, "it")).toEqual([
      "Acconto di 30 €, detratto dal prezzo finale.",
      "Spostamento gratuito una volta, fino a 48 h prima.",
      "Annullamento gratuito fino a 48 h prima; poi l’acconto viene trattenuto.",
      "Massimo 15 minuti di ritardo.",
      "Vieni da sola, senza accompagnatori.",
    ]);
  });

  it("states a fixed deposit with cents", () => {
    expect(text(with_({ deposit: { mode: "fixed", cents: 2550 } }), "it")[0]).toBe("Acconto di 25,50 €, detratto dal prezzo finale.");
  });

  it("states a percent deposit, eliding the article before a vowel", () => {
    expect(text(with_({ deposit: { mode: "percent", percent: 30 } }), "it")[0]).toBe("Acconto del 30% del prezzo, detratto dal prezzo finale.");
    expect(text(with_({ deposit: { mode: "percent", percent: 80 } }), "it")[0]).toBe("Acconto dell’80% del prezzo, detratto dal prezzo finale.");
  });

  it("states a full payment and talks about the amount paid", () => {
    expect(text(fullPayment, "it")).toEqual([
      "Pagamento completo online al momento della prenotazione.",
      "Spostamento gratuito una volta, fino a 48 h prima.",
      "Annullamento gratuito fino a 48 h prima.",
      "Tra 24 h e 48 h prima: il 50% dell’importo pagato viene trattenuto.",
      "Meno di 24 h prima: l’importo pagato viene trattenuto.",
      "Massimo 15 minuti di ritardo.",
      "Vieni da sola, senza accompagnatori.",
    ]);
  });

  it("says nothing about deposit or cancellation when nothing is paid online", () => {
    expect(text(with_({ deposit: { mode: "none" } }), "it")).toEqual([
      "Spostamento gratuito una volta, fino a 48 h prima.",
      "Massimo 15 minuti di ritardo.",
      "Vieni da sola, senza accompagnatori.",
    ]);
  });

  it("says when rescheduling is not possible", () => {
    expect(text(with_({ reschedule: { maxCount: 0, minHoursBefore: 48 } }), "it")[1]).toBe("Spostamento non possibile.");
  });

  it("uses the reschedule count and notice", () => {
    expect(text(with_({ reschedule: { maxCount: 2, minHoursBefore: 72 } }), "it")[1]).toBe("Spostamento gratuito fino a 2 volte, fino a 72 h prima.");
    expect(text(with_({ reschedule: { maxCount: 1, minHoursBefore: 0 } }), "it")[1]).toBe(
      "Spostamento gratuito una volta, fino all’inizio dell’appuntamento.",
    );
  });

  it("describes a middle cancellation tier", () => {
    expect(text(middleTier, "it").slice(2, 5)).toEqual([
      "Annullamento gratuito fino a 48 h prima.",
      "Tra 24 h e 48 h prima: il 50% dell’acconto viene trattenuto.",
      "Meno di 24 h prima: l’acconto viene trattenuto.",
    ]);
  });

  it("handles a single cancellation tier", () => {
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 0 }] }), "it")[2]).toBe("Annullamento gratuito in qualsiasi momento.");
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 100 }] }), "it")[2]).toBe(
      "In caso di annullamento, l’acconto viene trattenuto.",
    );
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 80 }] }), "it")[2]).toBe(
      "In caso di annullamento, l’80% dell’acconto viene trattenuto.",
    );
  });

  it("handles tiers without a free period", () => {
    expect(text(noFreePeriod, "it").slice(2, 4)).toEqual([
      "Più di 24 h prima: il 50% dell’acconto viene trattenuto.",
      "Meno di 24 h prima: l’acconto viene trattenuto.",
    ]);
  });

  it("says a free middle tier is free", () => {
    const rules = with_({
      cancellation: [
        { minHoursBefore: 48, keepPercent: 50 },
        { minHoursBefore: 24, keepPercent: 0 },
        { minHoursBefore: 0, keepPercent: 100 },
      ],
    });
    expect(text(rules, "it")[3]).toBe("Tra 24 h e 48 h prima: l’annullamento è gratuito.");
  });

  it("adds the late fee and auto-cancel sentences", () => {
    expect(text(lateFee, "it").slice(3, 6)).toEqual([
      "Massimo 15 minuti di ritardo.",
      "Oltre questo limite, supplemento di 10 € per il ritardo.",
      "Oltre 30 minuti di ritardo, la tua professionista può annullare l’appuntamento.",
    ]);
  });

  it("shortens auto-cancel when it starts with the grace period", () => {
    const rules = with_({ lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: 15 } });
    expect(text(rules, "it")[4]).toBe("Oltre questo limite, la tua professionista può annullare l’appuntamento.");
  });

  it("says when no lateness is accepted", () => {
    expect(text(with_({ lateness: { graceMinutes: 0, feeCents: null, autoCancelAfterMinutes: null } }), "it")[3]).toBe(
      "Nessun ritardo accettato.",
    );
  });

  it("drops the companions sentence when companions are allowed", () => {
    expect(text(with_({ companionsAllowed: true }), "it")).not.toContain("Vieni da sola, senza accompagnatori.");
  });

  it("appends extra rules, falling back to English, then French", () => {
    const rules = with_({
      extra: [
        { fr: "Cheveux lavés.", en: "Hair washed.", it: "Capelli lavati.", es: "Pelo lavado." },
        { fr: "Pas d’enfants.", en: "No children." },
        { fr: "Ponctuelle." },
      ],
    });
    expect(text(rules, "it").slice(-3)).toEqual(["Capelli lavati.", "No children.", "Ponctuelle."]);
  });
});

describe("rulesText in Spanish", () => {
  it("writes the default rules", () => {
    expect(text(base, "es")).toEqual([
      "Señal de 30 €, descontada del precio final.",
      "Cambio de cita gratuito una vez, hasta 48 h antes.",
      "Cancelación gratuita hasta 48 h antes; después, se retiene la señal.",
      "Máximo 15 minutos de retraso.",
      "Ven sola, sin acompañantes.",
    ]);
  });

  it("states a fixed deposit with cents", () => {
    expect(text(with_({ deposit: { mode: "fixed", cents: 2550 } }), "es")[0]).toBe("Señal de 25,50 €, descontada del precio final.");
  });

  it("states a percent deposit", () => {
    expect(text(with_({ deposit: { mode: "percent", percent: 30 } }), "es")[0]).toBe("Señal del 30 % del precio, descontada del precio final.");
  });

  it("states a full payment and talks about the amount paid", () => {
    expect(text(fullPayment, "es")).toEqual([
      "Pago completo online al reservar.",
      "Cambio de cita gratuito una vez, hasta 48 h antes.",
      "Cancelación gratuita hasta 48 h antes.",
      "Entre 24 h y 48 h antes: se retiene el 50 % del importe pagado.",
      "Menos de 24 h antes: se retiene el importe pagado.",
      "Máximo 15 minutos de retraso.",
      "Ven sola, sin acompañantes.",
    ]);
  });

  it("says nothing about deposit or cancellation when nothing is paid online", () => {
    expect(text(with_({ deposit: { mode: "none" } }), "es")).toEqual([
      "Cambio de cita gratuito una vez, hasta 48 h antes.",
      "Máximo 15 minutos de retraso.",
      "Ven sola, sin acompañantes.",
    ]);
  });

  it("says when rescheduling is not possible", () => {
    expect(text(with_({ reschedule: { maxCount: 0, minHoursBefore: 48 } }), "es")[1]).toBe("No se admiten cambios de cita.");
  });

  it("uses the reschedule count and notice", () => {
    expect(text(with_({ reschedule: { maxCount: 2, minHoursBefore: 72 } }), "es")[1]).toBe("Cambio de cita gratuito hasta 2 veces, hasta 72 h antes.");
    expect(text(with_({ reschedule: { maxCount: 1, minHoursBefore: 0 } }), "es")[1]).toBe("Cambio de cita gratuito una vez, hasta el inicio de la cita.");
  });

  it("describes a middle cancellation tier", () => {
    expect(text(middleTier, "es").slice(2, 5)).toEqual([
      "Cancelación gratuita hasta 48 h antes.",
      "Entre 24 h y 48 h antes: se retiene el 50 % de la señal.",
      "Menos de 24 h antes: se retiene la señal.",
    ]);
  });

  it("handles a single cancellation tier", () => {
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 0 }] }), "es")[2]).toBe("Cancelación gratuita en cualquier momento.");
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 100 }] }), "es")[2]).toBe("En caso de cancelación, se retiene la señal.");
    expect(text(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 50 }] }), "es")[2]).toBe(
      "En caso de cancelación, se retiene el 50 % de la señal.",
    );
  });

  it("handles tiers without a free period", () => {
    expect(text(noFreePeriod, "es").slice(2, 4)).toEqual([
      "Más de 24 h antes: se retiene el 50 % de la señal.",
      "Menos de 24 h antes: se retiene la señal.",
    ]);
  });

  it("says a free middle tier is free", () => {
    const rules = with_({
      cancellation: [
        { minHoursBefore: 48, keepPercent: 50 },
        { minHoursBefore: 24, keepPercent: 0 },
        { minHoursBefore: 0, keepPercent: 100 },
      ],
    });
    expect(text(rules, "es")[3]).toBe("Entre 24 h y 48 h antes: la cancelación es gratuita.");
  });

  it("adds the late fee and auto-cancel sentences", () => {
    expect(text(lateFee, "es").slice(3, 6)).toEqual([
      "Máximo 15 minutos de retraso.",
      "Pasado ese tiempo, recargo de 10 € por retraso.",
      "Con más de 30 minutos de retraso, tu profesional puede cancelar la cita.",
    ]);
  });

  it("shortens auto-cancel when it starts with the grace period", () => {
    const rules = with_({ lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: 15 } });
    expect(text(rules, "es")[4]).toBe("Pasado ese tiempo, tu profesional puede cancelar la cita.");
  });

  it("says when no lateness is accepted", () => {
    expect(text(with_({ lateness: { graceMinutes: 0, feeCents: null, autoCancelAfterMinutes: null } }), "es")[3]).toBe(
      "No se aceptan retrasos.",
    );
  });

  it("drops the companions sentence when companions are allowed", () => {
    expect(text(with_({ companionsAllowed: true }), "es")).not.toContain("Ven sola, sin acompañantes.");
  });

  it("appends extra rules, falling back to English, then French", () => {
    const rules = with_({
      extra: [
        { fr: "Cheveux lavés.", en: "Hair washed.", it: "Capelli lavati.", es: "Pelo lavado." },
        { fr: "Pas d’enfants.", en: "No children." },
        { fr: "Ponctuelle." },
      ],
    });
    expect(text(rules, "es").slice(-3)).toEqual(["Pelo lavado.", "No children.", "Ponctuelle."]);
  });
});

describe("rulesText spacing", () => {
  it("keeps non-breaking spaces before h, % and €", () => {
    const [deposit, , cancel] = rulesText(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 50 }] }), "es", "EUR");
    expect(deposit).toBe("Señal de 30 €, descontada del precio final.");
    expect(cancel).toBe("En caso de cancelación, se retiene el 50 % de la señal.");
    expect(rulesText(base, "it", "EUR")[1]).toBe("Spostamento gratuito una volta, fino a 48 h prima.");
  });
});

describe("cancellationSummary", () => {
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 9, 22, 8, 0);
  const at = (hoursBefore: number) => start - hoursBefore * HOUR;

  it("is free until the free tier ends", () => {
    expect(cancellationSummary(base, start, at(72))).toEqual({ kind: "freeUntil", until: at(48) });
  });

  it("keeps the next tier once the free deadline has passed", () => {
    expect(cancellationSummary(base, start, at(47))).toEqual({ kind: "keep", keepPercent: 100 });
    expect(cancellationSummary(fullPayment, start, at(30))).toEqual({ kind: "keep", keepPercent: 50 });
    expect(cancellationSummary(base, start, start + HOUR)).toEqual({ kind: "keep", keepPercent: 100 });
  });

  it("keeps a share from the start when the first tier is not free", () => {
    const strict = with_({ cancellation: [{ minHoursBefore: 24, keepPercent: 50 }] });
    expect(cancellationSummary(strict, start, at(72))).toEqual({ kind: "keep", keepPercent: 50 });
    expect(cancellationSummary(strict, start, at(2))).toEqual({ kind: "keep", keepPercent: 100 });
  });

  it("runs free tiers in a row together, and is free for good when nothing is ever kept", () => {
    const twoFree = with_({
      cancellation: [
        { minHoursBefore: 72, keepPercent: 0 },
        { minHoursBefore: 24, keepPercent: 0 },
        { minHoursBefore: 0, keepPercent: 100 },
      ],
    });
    expect(cancellationSummary(twoFree, start, at(96))).toEqual({ kind: "freeUntil", until: at(24) });
    expect(cancellationSummary(with_({ cancellation: [{ minHoursBefore: 0, keepPercent: 0 }] }), start, at(1))).toEqual({ kind: "free" });
  });

  it("is free when nothing is paid online", () => {
    expect(cancellationSummary(with_({ deposit: { mode: "none" } }), start, at(1))).toEqual({ kind: "free" });
  });
});

describe("rulesText in pounds", () => {
  const london = with_({ deposit: { mode: "fixed", cents: 2000 }, lateness: { graceMinutes: 10, feeCents: 550, autoCancelAfterMinutes: null } });
  const all = (rules: Rules, locale: "fr" | "en" | "it" | "es" | "pt") => rulesText(rules, locale, "GBP").map(nb);

  it("writes the deposit and the late fee in pounds", () => {
    expect(all(london, "en")[0]).toBe("£20 deposit, deducted from the final price.");
    expect(all(london, "en")).toContain("Beyond that, a £5.50 late fee applies.");
  });

  it("uses the plain pound sign in every language", () => {
    expect(all(london, "fr")[0]).toBe("Acompte de 20 £, déduit du prix final.");
    expect(all(london, "it")[0]).toBe("Acconto di 20 £, detratto dal prezzo finale.");
    expect(all(london, "es")[0]).toBe("Señal de 20 £, descontada del precio final.");
    expect(all(london, "pt")[0]).toBe("£20 deposit, deducted from the final price.");
  });

  it("leaves the sentences without an amount as they are", () => {
    expect(all(london, "en").slice(1)).toEqual(rulesText(london, "en", "EUR").map(nb).slice(1).map((s) => s.replace("€5.50", "£5.50")));
  });
});
