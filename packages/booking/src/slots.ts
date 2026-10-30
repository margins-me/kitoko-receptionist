import type { DayHours, Schedule } from "./schemas";
import { addDays, localDate, resolveLocal, weekdayOf } from "./time";
import type { Instant, LocalDate, LocalTime } from "./time";

export type Interval = { start: Instant; end: Instant };
export type BookingWindow = { until: LocalDate; next?: { opensAt: Instant; until: LocalDate } };
export type DayState = "open" | "full" | "closed" | "past" | "beyond_window" | "not_open_yet";
export type DayResult = {
  date: LocalDate;
  state: DayState;
  close?: LocalTime;
  opensAt?: Instant;
  slots: { time: LocalTime; start: Instant; end: Instant }[];
  hidden: { time: LocalTime; reason: "ends_after_close" | "overlaps_break" | "taken" }[];
};

type DayInput = {
  tz: string;
  schedule: Schedule;
  busy: Interval[];
  minutes: number;
  now: Instant;
  window: BookingWindow;
};

export function bookableUntil(i: {
  now: Instant;
  tz: string;
  window: Schedule["window"];
  openings: { opensAt: Instant; until: LocalDate }[];
}): BookingWindow {
  let until = i.window.kind === "rolling" ? addDays(localDate(i.now, i.tz), i.window.days) : i.window.date;
  for (const o of i.openings) if (o.opensAt <= i.now && o.until > until) until = o.until;
  const next = i.openings
    .filter((o) => o.opensAt > i.now && o.until > until)
    .sort((a, b) => a.opensAt - b.opensAt)[0];
  return next ? { until, next } : { until };
}

const toMinutes = (t: LocalTime) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number): LocalTime =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function daySlots(i: DayInput & { date: LocalDate; override?: DayHours | null }): DayResult {
  const none = { date: i.date, slots: [], hidden: [] };
  if (i.date < localDate(i.now, i.tz)) return { ...none, state: "past" };
  if (i.date > i.window.until) {
    const next = i.window.next;
    return next && i.date <= next.until
      ? { ...none, state: "not_open_yet", opensAt: next.opensAt }
      : { ...none, state: "beyond_window" };
  }
  const hours = i.override !== undefined ? i.override : i.schedule.weekly[weekdayOf(i.date)];
  if (!hours) return { ...none, state: "closed" };

  const open = toMinutes(hours.open);
  const step = i.schedule.stepMinutes;
  const candidates =
    hours.starts ??
    Array.from({ length: Math.ceil((toMinutes(hours.close) - open) / step) }, (_, n) => toTime(open + n * step));
  const at = (time: LocalTime) => resolveLocal(i.date, time, i.tz).at;
  const close = at(hours.close);
  const breaks = hours.breaks.map((b) => ({ start: at(b.from), end: at(b.to) }));
  const slots: DayResult["slots"] = [];
  const hidden: DayResult["hidden"] = [];
  for (const time of candidates) {
    const { at: start, skipped } = resolveLocal(i.date, time, i.tz);
    if (skipped || start <= i.now) continue;
    // Absolute minutes: a session on a DST-change day still lasts exactly its duration.
    const end = start + i.minutes * 60_000;
    const overlaps = (x: Interval) => x.start < end && start < x.end;
    if (end > close) hidden.push({ time, reason: "ends_after_close" });
    else if (breaks.some(overlaps)) hidden.push({ time, reason: "overlaps_break" });
    else if (i.busy.some(overlaps)) hidden.push({ time, reason: "taken" });
    else slots.push({ time, start, end });
  }
  const state = slots.length > 0 ? "open" : hidden.length > 0 ? "full" : "past";
  return { date: i.date, state, close: hours.close, slots, hidden };
}

export function weekSlots(
  i: DayInput & { from: LocalDate; days: number; overrides: Record<LocalDate, DayHours | null> },
): DayResult[] {
  return Array.from({ length: i.days }, (_, n) => {
    const date = addDays(i.from, n);
    return daySlots({ ...i, date, override: i.overrides[date] });
  });
}

/** A free start for a service with several staff: the staff ids free for the whole session, in the order given. */
export type StaffSlot = { time: LocalTime; start: Instant; end: Instant; staffIds: string[] };
export type StaffDayResult = Omit<DayResult, "slots"> & { slots: StaffSlot[] };

/**
 * daySlots for a business with several staff: the union of each eligible staff's daySlots, each start carrying the
 * staff free at it. `busy` blocks everyone (whole-business blocks); `staffBusy` holds each staff's own bookings and
 * blocks. A start no eligible staff is free at is hidden as "taken"; without eligible staff the day has no slots.
 */
export function staffSlots(
  i: DayInput & {
    date: LocalDate;
    override?: DayHours | null;
    staffIds: readonly string[];
    staffBusy: Readonly<Record<string, readonly Interval[]>>;
  },
): StaffDayResult {
  // The starts open to the business as a whole; each staff can only lose some of them.
  const shared = daySlots(i);
  const slots: StaffSlot[] = [];
  const taken: DayResult["hidden"] = [];
  for (const slot of shared.slots) {
    const overlaps = (x: Interval) => x.start < slot.end && slot.start < x.end;
    const staffIds = i.staffIds.filter((id) => !(i.staffBusy[id] ?? []).some(overlaps));
    if (staffIds.length > 0) slots.push({ ...slot, staffIds });
    else taken.push({ time: slot.time, reason: "taken" });
  }
  if (shared.slots.length === 0) return { ...shared, slots };
  const hidden = [...shared.hidden, ...taken].sort((a, b) => a.time.localeCompare(b.time));
  return { ...shared, state: slots.length > 0 ? "open" : "full", slots, hidden };
}
