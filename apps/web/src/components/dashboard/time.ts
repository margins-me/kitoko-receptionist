// Wall-clock arithmetic in the pro's time zone, with Intl only (no dependency). The calendar shows her time zone
// whatever the browser's: an instant becomes a local Date with her wall-clock values, and back.

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Her wall clock at an instant. weekday: 1 = Monday … 7 = Sunday. */
export function zonedParts(epoch: number, timeZone: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(epoch))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    weekday: WEEKDAYS[out.weekday ?? "Mon"] ?? 1,
  };
}

/** The instant at a wall-clock time in her zone (the earlier one in a DST overlap). */
export function zonedToEpoch(p: { year: number; month: number; day: number; hour?: number; minute?: number }, timeZone: string): number {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const q = zonedParts(guess, timeZone);
    const seen = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute);
    const next = guess + (wall - seen);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** An instant as a browser-local Date showing her wall clock (what Bryntum draws). */
export function toWallDate(epoch: number, timeZone: string): Date {
  const p = zonedParts(epoch, timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
}

/** A browser-local Date read as her wall clock, back to the instant. */
export function fromWallDate(date: Date, timeZone: string): number {
  return zonedToEpoch(
    { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() },
    timeZone,
  );
}

/** Monday 00:00 of the week holding `epoch`, in her zone. */
export function weekStartOf(epoch: number, timeZone: string): number {
  const p = zonedParts(epoch, timeZone);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.weekday - 1)));
  return zonedToEpoch({ year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate() }, timeZone);
}

/** `days` calendar days after the midnight `epoch`, in her zone (DST safe). */
export function addDays(epoch: number, days: number, timeZone: string): number {
  const p = zonedParts(epoch, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToEpoch({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, timeZone);
}

/** "yyyy-mm-dd" of her day. */
export function dayKey(epoch: number, timeZone: string): string {
  const p = zonedParts(epoch, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "14:00" in her zone. */
export function formatClock(epoch: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(epoch);
}

/** "Wed 28 Oct" in her zone. */
export function formatDay(epoch: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(epoch);
}

/** "26 Oct – 1 Nov 2026". */
export function formatWeek(start: number, timeZone: string): string {
  const end = addDays(start, 6, timeZone);
  const a = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(start);
  const b = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(end);
  return `${a} – ${b}`;
}

/** "12:41" left until `until` (never negative). */
export function formatCountdown(until: number, now: number): string {
  const s = Math.max(0, Math.floor((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
