import type { Addon, DayHours, OptionGroup, Rules, Schedule, ServiceDef } from "../src/schemas";
import { resolveLocal } from "../src/time";

// Nala Braids, Paris 18e. The DB seed uses the same data.
export const TZ = "Europe/Paris";

export const paris = (date: string, time: string) => resolveLocal(date, time, TZ).at;

const longueur: OptionGroup = {
  id: "longueur",
  label: { fr: "Longueur", en: "Length" },
  default: "mi-dos",
  options: [
    { id: "epaules", label: { fr: "Épaules" }, priceCents: 0, minutes: 0 },
    { id: "mi-dos", label: { fr: "Mi-dos" }, priceCents: 2000, minutes: 45 },
    { id: "taille", label: { fr: "Taille" }, priceCents: 4000, minutes: 90 },
  ],
};

const meches: OptionGroup = {
  id: "meches",
  label: { fr: "Mèches", en: "Hair" },
  default: "incluses",
  options: [
    { id: "incluses", label: { fr: "Mèches incluses" }, priceCents: 1500, minutes: 0 },
    { id: "apportees", label: { fr: "J'apporte les miennes" }, priceCents: 0, minutes: 0 },
  ],
};

const addons: Addon[] = [
  { id: "shampoing", label: { fr: "Shampoing" }, priceCents: 1000, minutes: 20 },
  { id: "retrait", label: { fr: "Retrait ancienne coiffure" }, priceCents: 2500, minutes: 60 },
];

const service = (s: Pick<ServiceDef, "id" | "name" | "basePriceCents" | "baseMinutes" | "optionGroups">): ServiceDef => ({
  ...s,
  addons,
  conditions: [],
  deposit: null,
});

export const knotless = service({
  id: "knotless",
  name: { fr: "Knotless braids" },
  basePriceCents: 8500,
  baseMinutes: 240,
  optionGroups: [
    {
      id: "taille",
      label: { fr: "Taille des tresses", en: "Braid size" },
      default: "m",
      options: [
        { id: "l", label: { fr: "L, épaisses" }, priceCents: 0, minutes: 0 },
        { id: "m", label: { fr: "M, moyennes" }, priceCents: 2500, minutes: 90 },
        { id: "s", label: { fr: "S, fines" }, priceCents: 5500, minutes: 180 },
      ],
    },
    longueur,
    meches,
  ],
});

export const box = service({
  id: "box",
  name: { fr: "Box braids" },
  basePriceCents: 7500,
  baseMinutes: 225,
  optionGroups: [
    {
      id: "taille",
      label: { fr: "Taille des tresses", en: "Braid size" },
      default: "m",
      options: [
        { id: "l", label: { fr: "L, épaisses" }, priceCents: 0, minutes: 0 },
        { id: "m", label: { fr: "M, moyennes" }, priceCents: 2000, minutes: 75 },
        { id: "s", label: { fr: "S, fines" }, priceCents: 4500, minutes: 165 },
      ],
    },
    longueur,
    meches,
  ],
});

const fulani = service({
  id: "fulani",
  name: { fr: "Fulani braids" },
  basePriceCents: 9000,
  baseMinutes: 270,
  optionGroups: [longueur, meches],
});

export const nattes = service({
  id: "nattes",
  name: { fr: "Nattes collées" },
  basePriceCents: 4500,
  baseMinutes: 90,
  optionGroups: [],
});

export const services = [knotless, box, fulani, nattes];

// Test-only: not in the seed.
export const withConditions: ServiceDef = {
  ...nattes,
  id: "nattes-conditions",
  conditions: [{ fr: "Cheveux de 10 cm minimum." }],
};

export const rules: Rules = {
  deposit: { mode: "fixed", cents: 3000 },
  feePayer: "client",
  reschedule: { maxCount: 1, minHoursBefore: 48 },
  cancellation: [
    { minHoursBefore: 48, keepPercent: 0 },
    { minHoursBefore: 0, keepPercent: 100 },
  ],
  lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: null },
  balanceMethods: ["cash", "external"],
  companionsAllowed: false,
  extra: [
    {
      fr: "Cheveux lavés, démêlés et secs à l'arrivée, sauf option shampoing.",
      en: "Hair washed, detangled and dry on arrival, unless you add the shampoo option.",
    },
  ],
};

const weekday: DayHours = { open: "09:00", close: "19:00", breaks: [], starts: ["09:00", "13:00", "15:30"] };

export const schedule: Schedule = {
  weekly: {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: { open: "09:00", close: "17:00", breaks: [], starts: ["09:00", "13:00"] },
    sun: null,
  },
  stepMinutes: 30,
  window: { kind: "rolling", days: 60 },
};
