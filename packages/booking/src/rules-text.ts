import { formatMoney } from "./currency";
import type { Currency } from "./currency";
import { pickText } from "./locale";
import type { Locale } from "./locale";
import type { CancellationTier, Rules } from "./schemas";

const NBSP = " ";
const hours = (h: number) => `${h}${NBSP}h`;
const HOUR = 3_600_000;

// Italian elides the article before a number read with a leading vowel: "l’80%", "dell’8%", but "il 50%", "del 30%".
const itVowel = (n: number) => /^(1|8|11|8\d)$/.test(String(n));
const itThe = (n: number) => (itVowel(n) ? "l’" : "il ");
const itOfThe = (n: number) => (itVowel(n) ? "dell’" : "del ");

type Paid = "deposit" | "full";

type Copy = {
  /** What a cancellation keeps, in the words of the deposit mode: "full" = everything was paid online. */
  kept(percent: number, paid: Paid): string;
  freeAnyTime: string;
  ifCancelled(kept: string): string;
  freeUntilThen(before: string, after: string): string;
  freeUntil(before: string): string;
  moreThan(before: string, kept: string): string;
  between(from: string, to: string, kept: string): string;
  lessThan(before: string, kept: string): string;
  depositFixed(amount: string): string;
  depositPercent(percent: number): string;
  depositFull: string;
  noReschedule: string;
  rescheduleCount(count: number): string;
  rescheduleUntil(before: string): string;
  rescheduleUntilStart: string;
  reschedule(count: string, until: string): string;
  grace(minutes: number): string;
  noLateness: string;
  lateFee(amount: string): string;
  autoCancelAfterGrace: string;
  autoCancelAfter(minutes: number): string;
  comeAlone: string;
};

// Portuguese reads English until it is written by hand (needs native pt-PT copy).
const COPY: Record<Exclude<Locale, "pt">, Copy> = {
  fr: {
    kept: (percent, paid) => {
      const full = paid === "full";
      const thing = full ? "le montant payé" : "l’acompte";
      const ofThing = full ? "du montant payé" : "de l’acompte";
      if (percent >= 100) return `${thing} est gardé`;
      if (percent <= 0) return "l’annulation est gratuite";
      return `${percent}${NBSP}% ${ofThing} est gardé`;
    },
    freeAnyTime: "Annulation gratuite à tout moment.",
    ifCancelled: (kept) => `En cas d’annulation, ${kept}.`,
    freeUntilThen: (before, after) => `Annulation gratuite jusqu’à ${before} avant${NBSP}; ensuite ${after}.`,
    freeUntil: (before) => `Annulation gratuite jusqu’à ${before} avant.`,
    moreThan: (before, kept) => `Plus de ${before} avant${NBSP}: ${kept}.`,
    between: (from, to, kept) => `Entre ${from} et ${to} avant${NBSP}: ${kept}.`,
    lessThan: (before, kept) => `Moins de ${before} avant${NBSP}: ${kept}.`,
    depositFixed: (amount) => `Acompte de ${amount}, déduit du prix final.`,
    depositPercent: (percent) => `Acompte de ${percent}${NBSP}% du prix, déduit du prix final.`,
    depositFull: "Paiement complet en ligne à la réservation.",
    noReschedule: "Pas de report possible.",
    rescheduleCount: (count) => (count === 1 ? "une fois" : `jusqu’à ${count} fois`),
    rescheduleUntil: (before) => `jusqu’à ${before} avant`,
    rescheduleUntilStart: "jusqu’au début du rendez-vous",
    reschedule: (count, until) => `Report gratuit ${count}, ${until}.`,
    grace: (minutes) => `${minutes} minutes de retard maximum.`,
    noLateness: "Pas de retard accepté.",
    lateFee: (amount) => `Au-delà, ${amount} de frais de retard.`,
    autoCancelAfterGrace: "Au-delà, ta pro peut annuler le rendez-vous.",
    autoCancelAfter: (minutes) => `Au-delà de ${minutes} minutes de retard, ta pro peut annuler le rendez-vous.`,
    comeAlone: "Viens seule, sans accompagnant.",
  },
  en: {
    kept: (percent, paid) => {
      const thing = paid === "full" ? "the amount paid" : "the deposit";
      if (percent >= 100) return `${thing} is kept`;
      if (percent <= 0) return "cancelling is free";
      return `${percent}% of ${thing} is kept`;
    },
    freeAnyTime: "Free cancellation at any time.",
    ifCancelled: (kept) => `If you cancel, ${kept}.`,
    freeUntilThen: (before, after) => `Free cancellation up to ${before} before; after that ${after}.`,
    freeUntil: (before) => `Free cancellation up to ${before} before.`,
    moreThan: (before, kept) => `More than ${before} before: ${kept}.`,
    between: (from, to, kept) => `Between ${from} and ${to} before: ${kept}.`,
    lessThan: (before, kept) => `Less than ${before} before: ${kept}.`,
    depositFixed: (amount) => `${amount} deposit, deducted from the final price.`,
    depositPercent: (percent) => `Deposit of ${percent}% of the price, deducted from the final price.`,
    depositFull: "Full payment online when you book.",
    noReschedule: "No rescheduling.",
    rescheduleCount: (count) => (count === 1 ? "once" : `up to ${count} times`),
    rescheduleUntil: (before) => `up to ${before} before`,
    rescheduleUntilStart: "until the appointment starts",
    reschedule: (count, until) => `Free rescheduling ${count}, ${until}.`,
    grace: (minutes) => `${minutes} minutes late at most.`,
    noLateness: "No lateness accepted.",
    lateFee: (amount) => `Beyond that, a ${amount} late fee applies.`,
    autoCancelAfterGrace: "Beyond that, your pro may cancel the appointment.",
    autoCancelAfter: (minutes) => `Beyond ${minutes} minutes late, your pro may cancel the appointment.`,
    comeAlone: "Come alone, without a companion.",
  },
  it: {
    kept: (percent, paid) => {
      const full = paid === "full";
      const thing = full ? "l’importo pagato" : "l’acconto";
      const ofThing = full ? "dell’importo pagato" : "dell’acconto";
      if (percent >= 100) return `${thing} viene trattenuto`;
      if (percent <= 0) return "l’annullamento è gratuito";
      return `${itThe(percent)}${percent}% ${ofThing} viene trattenuto`;
    },
    freeAnyTime: "Annullamento gratuito in qualsiasi momento.",
    ifCancelled: (kept) => `In caso di annullamento, ${kept}.`,
    freeUntilThen: (before, after) => `Annullamento gratuito fino a ${before} prima; poi ${after}.`,
    freeUntil: (before) => `Annullamento gratuito fino a ${before} prima.`,
    moreThan: (before, kept) => `Più di ${before} prima: ${kept}.`,
    between: (from, to, kept) => `Tra ${from} e ${to} prima: ${kept}.`,
    lessThan: (before, kept) => `Meno di ${before} prima: ${kept}.`,
    depositFixed: (amount) => `Acconto di ${amount}, detratto dal prezzo finale.`,
    depositPercent: (percent) => `Acconto ${itOfThe(percent)}${percent}% del prezzo, detratto dal prezzo finale.`,
    depositFull: "Pagamento completo online al momento della prenotazione.",
    noReschedule: "Spostamento non possibile.",
    rescheduleCount: (count) => (count === 1 ? "una volta" : `fino a ${count} volte`),
    rescheduleUntil: (before) => `fino a ${before} prima`,
    rescheduleUntilStart: "fino all’inizio dell’appuntamento",
    reschedule: (count, until) => `Spostamento gratuito ${count}, ${until}.`,
    grace: (minutes) => `Massimo ${minutes} minuti di ritardo.`,
    noLateness: "Nessun ritardo accettato.",
    lateFee: (amount) => `Oltre questo limite, supplemento di ${amount} per il ritardo.`,
    autoCancelAfterGrace: "Oltre questo limite, la tua professionista può annullare l’appuntamento.",
    autoCancelAfter: (minutes) => `Oltre ${minutes} minuti di ritardo, la tua professionista può annullare l’appuntamento.`,
    comeAlone: "Vieni da sola, senza accompagnatori.",
  },
  es: {
    kept: (percent, paid) => {
      const full = paid === "full";
      const thing = full ? "el importe pagado" : "la señal";
      const ofThing = full ? "del importe pagado" : "de la señal";
      if (percent >= 100) return `se retiene ${thing}`;
      if (percent <= 0) return "la cancelación es gratuita";
      return `se retiene el ${percent}${NBSP}% ${ofThing}`;
    },
    freeAnyTime: "Cancelación gratuita en cualquier momento.",
    ifCancelled: (kept) => `En caso de cancelación, ${kept}.`,
    freeUntilThen: (before, after) => `Cancelación gratuita hasta ${before} antes; después, ${after}.`,
    freeUntil: (before) => `Cancelación gratuita hasta ${before} antes.`,
    moreThan: (before, kept) => `Más de ${before} antes: ${kept}.`,
    between: (from, to, kept) => `Entre ${from} y ${to} antes: ${kept}.`,
    lessThan: (before, kept) => `Menos de ${before} antes: ${kept}.`,
    depositFixed: (amount) => `Señal de ${amount}, descontada del precio final.`,
    depositPercent: (percent) => `Señal del ${percent}${NBSP}% del precio, descontada del precio final.`,
    depositFull: "Pago completo online al reservar.",
    noReschedule: "No se admiten cambios de cita.",
    rescheduleCount: (count) => (count === 1 ? "una vez" : `hasta ${count} veces`),
    rescheduleUntil: (before) => `hasta ${before} antes`,
    rescheduleUntilStart: "hasta el inicio de la cita",
    reschedule: (count, until) => `Cambio de cita gratuito ${count}, ${until}.`,
    grace: (minutes) => `Máximo ${minutes} minutos de retraso.`,
    noLateness: "No se aceptan retrasos.",
    lateFee: (amount) => `Pasado ese tiempo, recargo de ${amount} por retraso.`,
    autoCancelAfterGrace: "Pasado ese tiempo, tu profesional puede cancelar la cita.",
    autoCancelAfter: (minutes) => `Con más de ${minutes} minutos de retraso, tu profesional puede cancelar la cita.`,
    comeAlone: "Ven sola, sin acompañantes.",
  },
};

/** Tiers from the earliest to the latest, one per threshold, ending at 0 h (no matching tier keeps everything). */
export function normaliseTiers(tiers: CancellationTier[]): CancellationTier[] {
  const sorted = tiers.toSorted((a, b) => b.minHoursBefore - a.minHoursBefore);
  const unique = sorted.filter((t, i) => i === 0 || t.minHoursBefore !== sorted[i - 1]!.minHoursBefore);
  const last = unique.at(-1);
  if (!last || last.minHoursBefore > 0) unique.push({ minHoursBefore: 0, keepPercent: 100 });
  return unique;
}

export type CancellationSummary = { kind: "free" } | { kind: "freeUntil"; until: number } | { kind: "keep"; keepPercent: number };

/** What cancelling costs from `now`: free for good, free until a moment, or a share of what was paid online kept. */
export function cancellationSummary(rules: Rules, startsAt: number, now: number): CancellationSummary {
  // Nothing is paid online, so there is nothing to keep.
  if (rules.deposit.mode === "none") return { kind: "free" };
  const tiers = normaliseTiers(rules.cancellation);
  const hoursLeft = (startsAt - now) / HOUR;
  // Once the appointment has started, the last tier (0 h) applies.
  const found = tiers.findIndex((t) => t.minHoursBefore <= hoursLeft);
  const index = found === -1 ? tiers.length - 1 : found;
  const current = tiers[index]!;
  if (current.keepPercent > 0) return { kind: "keep", keepPercent: current.keepPercent };
  // Free now: it stays free until the last free tier in a row ends.
  let last = current;
  for (const tier of tiers.slice(index + 1)) {
    if (tier.keepPercent > 0) break;
    last = tier;
  }
  if (last.minHoursBefore <= 0) return { kind: "free" };
  return { kind: "freeUntil", until: startsAt - last.minHoursBefore * HOUR };
}

function cancellation(rules: Rules, c: Copy): string[] {
  // Nothing is paid online, so there is nothing to keep.
  if (rules.deposit.mode === "none") return [];
  const paid: Paid = rules.deposit.mode === "full" ? "full" : "deposit";
  const tiers = normaliseTiers(rules.cancellation);
  const [first, ...rest] = tiers;
  if (!first) return [];

  // A single tier applies at any time.
  if (rest.length === 0) {
    if (first.keepPercent <= 0) return [c.freeAnyTime];
    return [c.ifCancelled(c.kept(first.keepPercent, paid))];
  }

  const free = first.keepPercent <= 0;
  if (free && rest.length === 1) {
    return [c.freeUntilThen(hours(first.minHoursBefore), c.kept(rest[0]!.keepPercent, paid))];
  }
  const sentences = [
    free ? c.freeUntil(hours(first.minHoursBefore)) : c.moreThan(hours(first.minHoursBefore), c.kept(first.keepPercent, paid)),
  ];
  tiers.slice(1).forEach((tier, i) => {
    const above = hours(tiers[i]!.minHoursBefore);
    const what = c.kept(tier.keepPercent, paid);
    sentences.push(tier.minHoursBefore > 0 ? c.between(hours(tier.minHoursBefore), above, what) : c.lessThan(above, what));
  });
  return sentences;
}

function deposit(rules: Rules, c: Copy, locale: Locale, currency: Currency): string[] {
  const d = rules.deposit;
  switch (d.mode) {
    case "none":
      return [];
    case "fixed":
      return [c.depositFixed(formatMoney(d.cents, locale, currency))];
    case "percent":
      return [c.depositPercent(d.percent)];
    case "full":
      return [c.depositFull];
  }
}

function reschedule(rules: Rules, c: Copy): string[] {
  const { maxCount, minHoursBefore } = rules.reschedule;
  if (maxCount === 0) return [c.noReschedule];
  const until = minHoursBefore > 0 ? c.rescheduleUntil(hours(minHoursBefore)) : c.rescheduleUntilStart;
  return [c.reschedule(c.rescheduleCount(maxCount), until)];
}

function lateness(rules: Rules, c: Copy, locale: Locale, currency: Currency): string[] {
  const { graceMinutes, feeCents, autoCancelAfterMinutes } = rules.lateness;
  const sentences = [graceMinutes > 0 ? c.grace(graceMinutes) : c.noLateness];
  if (feeCents !== null && feeCents > 0) sentences.push(c.lateFee(formatMoney(feeCents, locale, currency)));
  if (autoCancelAfterMinutes !== null) {
    sentences.push(autoCancelAfterMinutes === graceMinutes ? c.autoCancelAfterGrace : c.autoCancelAfter(autoCancelAfterMinutes));
  }
  return sentences;
}

// The client-facing rule sentences, generated from the pro's settings (never free text alone). Amounts in her currency.
export function rulesText(rules: Rules, locale: Locale, currency: Currency): string[] {
  // Amounts are written the way the sentence's language writes them: Portuguese reads English ("£20", not "20 £").
  const written = locale === "pt" ? "en" : locale;
  const c = COPY[written];
  return [
    ...deposit(rules, c, written, currency),
    ...reschedule(rules, c),
    ...cancellation(rules, c),
    ...lateness(rules, c, written, currency),
    ...(rules.companionsAllowed ? [] : [c.comeAlone]),
    ...rules.extra.map((text) => pickText(text, locale).trim()),
  ].filter((s) => s.length > 0);
}
