import { Temporal } from "temporal-polyfill";
import { WEEKDAYS } from "./schemas";
import type { Weekday } from "./schemas";

export type Instant = number;
export type LocalDate = string;
export type LocalTime = string;

export function resolveLocal(date: LocalDate, time: LocalTime, tz: string): { at: Instant; skipped: boolean } {
  const wall = Temporal.PlainDateTime.from(`${date}T${time}`);
  const zoned = wall.toZonedDateTime(tz, { disambiguation: "compatible" });
  return { at: zoned.epochMilliseconds, skipped: !zoned.toPlainDateTime().equals(wall) };
}

export function localDate(at: Instant, tz: string): LocalDate {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(tz).toPlainDate().toString();
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return Temporal.PlainDate.from(date).add({ days: n }).toString();
}

export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[Temporal.PlainDate.from(date).dayOfWeek - 1]!;
}
