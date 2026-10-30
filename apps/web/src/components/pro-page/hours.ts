import { WEEKDAYS } from "@kitoko/booking/schemas";
import type { DayHours, Schedule } from "@kitoko/booking";
import { intlTag } from "@/i18n/locale";

export type HoursGroup = { first: number; last: number; hours: DayHours | null };

const same = (a: DayHours | null, b: DayHours | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.open === b.open &&
    a.close === b.close &&
    JSON.stringify(a.breaks) === JSON.stringify(b.breaks));

/** Consecutive weekdays (0 = Monday) with the same hours, e.g. Mon–Fri 9–19, Sat 9–17, Sun closed. */
export function weeklyGroups(schedule: Schedule): HoursGroup[] {
  const groups: HoursGroup[] = [];
  WEEKDAYS.forEach((day, i) => {
    const hours = schedule.weekly[day];
    const last = groups.at(-1);
    if (last && same(last.hours, hours)) last.last = i;
    else groups.push({ first: i, last: i, hours });
  });
  return groups;
}

/** Opening intervals of a day, breaks cut out: [["09:00", "12:00"], ["13:00", "19:00"]]. */
export function openIntervals(hours: DayHours): [string, string][] {
  const out: [string, string][] = [];
  let from = hours.open;
  for (const b of hours.breaks.toSorted((x, y) => x.from.localeCompare(y.from))) {
    out.push([from, b.from]);
    from = b.to;
  }
  out.push([from, hours.close]);
  return out.filter(([a, b]) => a < b);
}

// 2026-10-19 is a Monday: weekday i is that date plus i days.
export const weekdayDate = (i: number): string => `2026-10-${19 + i}`;

/** "Monday", "lundi": weekday i (0 = Monday) in the page's language. */
export const weekdayLong = (i: number, locale: string): string =>
  new Intl.DateTimeFormat(intlTag(locale), { weekday: "long", timeZone: "UTC" }).format(new Date(`${weekdayDate(i)}T12:00:00Z`));

export const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);
