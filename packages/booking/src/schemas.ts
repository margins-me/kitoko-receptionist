import { z } from "zod";

// Shapes stored as JSONB in Postgres (pros.rules, pros.schedule, services.option_groups,
// services.addons, bookings.selection). Money in cents, durations in minutes.

export const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
export const LocalDateSchema = z.iso.date();

export const LocalizedTextSchema = z.object({
  fr: z.string().min(1),
  en: z.string().min(1).optional(),
  it: z.string().min(1).optional(),
  es: z.string().min(1).optional(),
});

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const cents = z.int().nonnegative();
const minutesOfDay = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const OptionSchema = z.object({
  id,
  label: LocalizedTextSchema,
  priceCents: z.int(),
  minutes: z.int(),
});

export const OptionGroupSchema = z
  .object({
    id,
    label: LocalizedTextSchema,
    default: id.optional(),
    options: z.array(OptionSchema).min(1),
  })
  .refine((g) => g.default === undefined || g.options.some((o) => o.id === g.default), {
    message: "default must be one of the options",
  });

export const AddonSchema = z.object({
  id,
  label: LocalizedTextSchema,
  priceCents: cents,
  minutes: z.int().nonnegative(),
});

export const DepositRuleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("fixed"), cents: z.int().positive() }),
  z.object({ mode: z.literal("percent"), percent: z.int().min(1).max(100) }),
  z.object({ mode: z.literal("full") }),
]);

export const CancellationTierSchema = z.object({
  minHoursBefore: z.int().nonnegative(),
  keepPercent: z.int().min(0).max(100),
});

export const RulesSchema = z.object({
  deposit: DepositRuleSchema,
  feePayer: z.enum(["client", "pro"]),
  reschedule: z.object({
    maxCount: z.int().nonnegative(),
    minHoursBefore: z.int().nonnegative(),
  }),
  cancellation: z.array(CancellationTierSchema).min(1),
  lateness: z.object({
    graceMinutes: z.int().nonnegative(),
    feeCents: cents.nullable(),
    autoCancelAfterMinutes: z.int().positive().nullable(),
  }),
  balanceMethods: z.array(z.enum(["cash", "external"])).min(1),
  companionsAllowed: z.boolean(),
  extra: z.array(LocalizedTextSchema),
});

export const DayHoursSchema = z
  .object({
    open: LocalTimeSchema,
    close: LocalTimeSchema,
    breaks: z.array(z.object({ from: LocalTimeSchema, to: LocalTimeSchema })),
    starts: z.array(LocalTimeSchema).optional(),
  })
  .refine((d) => minutesOfDay(d.open) < minutesOfDay(d.close), { message: "open must be before close" })
  .refine(
    (d) =>
      d.breaks.every(
        (b) =>
          minutesOfDay(d.open) <= minutesOfDay(b.from) &&
          minutesOfDay(b.from) < minutesOfDay(b.to) &&
          minutesOfDay(b.to) <= minutesOfDay(d.close),
      ),
    { message: "breaks must sit inside opening hours" },
  )
  .refine(
    (d) =>
      (d.starts ?? []).every(
        (s) => minutesOfDay(d.open) <= minutesOfDay(s) && minutesOfDay(s) < minutesOfDay(d.close),
      ),
    { message: "start times must sit inside opening hours" },
  )
  .refine((d) => new Set(d.starts ?? []).size === (d.starts ?? []).length, {
    message: "start times must be unique",
  });

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const ScheduleSchema = z.object({
  weekly: z.object({
    mon: DayHoursSchema.nullable(),
    tue: DayHoursSchema.nullable(),
    wed: DayHoursSchema.nullable(),
    thu: DayHoursSchema.nullable(),
    fri: DayHoursSchema.nullable(),
    sat: DayHoursSchema.nullable(),
    sun: DayHoursSchema.nullable(),
  }),
  stepMinutes: z.int().min(5).max(240),
  window: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("rolling"), days: z.int().min(1).max(366) }),
    z.object({ kind: z.literal("until"), date: LocalDateSchema }),
  ]),
});

export const SelectionSchema = z.object({
  options: z.record(z.string(), z.string()),
  addons: z.array(z.string()),
  conditionsAccepted: z.boolean(),
});

export const QuoteLineSchema = z.object({
  kind: z.enum(["base", "option", "addon"]),
  id: z.string(),
  label: LocalizedTextSchema,
  group: LocalizedTextSchema.optional(),
  priceCents: z.int(),
  minutes: z.int(),
});

// bookings.selection: what the client picked, with prices frozen at booking time.
export const SelectionSnapshotSchema = z.object({
  selection: SelectionSchema,
  lines: z.array(QuoteLineSchema).min(1),
});

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type OptionGroup = z.infer<typeof OptionGroupSchema>;
export type Addon = z.infer<typeof AddonSchema>;
export type DepositRule = z.infer<typeof DepositRuleSchema>;
export type CancellationTier = z.infer<typeof CancellationTierSchema>;
export type Rules = z.infer<typeof RulesSchema>;
export type DayHours = z.infer<typeof DayHoursSchema>;
export type Weekday = (typeof WEEKDAYS)[number];
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type QuoteLine = z.infer<typeof QuoteLineSchema>;
export type SelectionSnapshot = z.infer<typeof SelectionSnapshotSchema>;

// A service as the engine needs it (columns of public.services).
export type ServiceDef = {
  id: string;
  name: LocalizedText;
  basePriceCents: number;
  baseMinutes: number;
  optionGroups: OptionGroup[];
  addons: Addon[];
  conditions: LocalizedText[];
  deposit: DepositRule | null;
};
