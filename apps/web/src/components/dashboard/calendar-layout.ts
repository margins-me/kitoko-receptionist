// What the Bryntum calendar draws, as plain data: one row per day (× staff member in a studio), all rows sharing one
// 08:00–21:00 time axis. Every row is a virtual resource `${day}|${staffId}`; an event is moved onto the axis's
// reference day at its local time, and a drop is read back from the row it lands in. No Bryntum import here.

import { bookingMoneyCents, lookLabel, lookOf } from "./model";
import type { AgentChange, CalBlock, CalBooking, CascadeOffer, OpenHours, StaffRow } from "./model";
import { addDays, dayKey, formatClock, formatDay, zonedParts, zonedToEpoch } from "./time";

export type Zoom = "week" | "day";

/** The hours on the axis (her wall clock). */
export const AXIS = { from: 8, to: 21 };

export type LayoutInput = {
  staff: StaffRow[];
  timeZone: string;
  weekStart: number;
  zoom: Zoom;
  focusDay: number;
};

export type Row = {
  id: string;
  /** Midnight of the row's day, her zone. */
  day: number;
  dayKey: string;
  /** "Mon 26 Oct". */
  dayLabel: string;
  staffId: string;
  staffName: string;
  color: string | null;
  today: boolean;
  /** Last staff row of its day (a stronger line under it in a studio's week). */
  lastOfDay: boolean;
};

export const rowId = (key: string, staffId: string) => `${key}|${staffId}`;

/** The days shown: the focused one, or the seven of the week. */
export function daysOf(p: LayoutInput): number[] {
  return p.zoom === "day" ? [p.focusDay] : Array.from({ length: 7 }, (_, i) => addDays(p.weekStart, i, p.timeZone));
}

export function rowsOf(p: LayoutInput, now: number): Row[] {
  const todayKey = dayKey(now, p.timeZone);
  return daysOf(p).flatMap((day) => {
    const key = dayKey(day, p.timeZone);
    return p.staff.map((s, i) => ({
      id: rowId(key, s.id),
      day,
      dayKey: key,
      dayLabel: formatDay(day, p.timeZone),
      staffId: s.id,
      staffName: s.name,
      color: s.color,
      today: key === todayKey,
      lastOfDay: i === p.staff.length - 1,
    }));
  });
}

/** The axis: the first shown day, 08:00 → 21:00, as browser-local Dates carrying her wall clock. */
export type Axis = { year: number; month: number; day: number };

export function axisOf(p: LayoutInput): Axis {
  const first = daysOf(p)[0] ?? p.weekStart;
  const { year, month, day } = zonedParts(first, p.timeZone);
  return { year, month, day };
}

/** Minutes after midnight on the axis → the Date Bryntum draws. */
export const axisDate = (a: Axis, minutes: number) => new Date(a.year, a.month - 1, a.day, 0, minutes);

export const axisSpan = (a: Axis): [Date, Date] => [axisDate(a, AXIS.from * 60), axisDate(a, AXIS.to * 60)];

/** An instant → its row's day and its place on the axis. */
export function toAxis(epoch: number, timeZone: string, a: Axis): { key: string; date: Date } {
  const p = zonedParts(epoch, timeZone);
  return { key: dayKey(epoch, timeZone), date: axisDate(a, p.hour * 60 + p.minute) };
}

/** A place on the axis in the row of `day` (midnight) → the instant. */
export function fromAxis(date: Date, day: number, timeZone: string): number {
  const { year, month, day: d } = zonedParts(day, timeZone);
  return zonedToEpoch({ year, month, day: d, hour: date.getHours(), minute: date.getMinutes() }, timeZone);
}

const minutesOf = (epoch: number, timeZone: string) => {
  const p = zonedParts(epoch, timeZone);
  return p.hour * 60 + p.minute;
};

/** Bookings still taking the chair (cancelled and expired ones stay visible but free the time). */
export const occupies = (b: CalBooking) => b.status !== "cancelled" && b.status !== "expired";

// ---- what the scheduler's stores hold ------------------------------------------------------------------------

/** A booking; a move the pro proposed (ghost); a time the receptionist offered a displaced booking's client (offer). */
export type Kind = "booking" | "ghost" | "offer";

export type EventData = {
  id: string;
  resourceId: string;
  startDate: Date;
  endDate: Date;
  name: string;
  draggable: boolean;
  resizable: boolean;
  kind: Kind;
  bookingId: string;
  look: string;
  flash: boolean;
  /** The receptionist changed it on the client's answer (✦). */
  agent: boolean;
  /** An offer or proposal leaving (the client answered): fades out before it is removed. */
  fading: boolean;
  /** An offer's start (epoch ms): the time the receptionist offered. */
  offerStart?: number;
  /** Changes whenever anything the event shows changes, so set() re-renders it. */
  sig: string;
};

export const movable = (b: CalBooking) => {
  const look = lookOf(b);
  return look === "confirmed" || look === "unpaid" || look === "displaced";
};

export type EventsInput = LayoutInput & {
  bookings: CalBooking[];
  proposals: Record<string, number>;
  flash: Record<string, number>;
  offers: Record<string, CascadeOffer>;
  agentChanges: Record<string, AgentChange>;
};

/** The times still offered to a displaced booking's client (none once the pro proposed one herself). */
export function offeredStarts(b: CalBooking, p: Pick<EventsInput, "offers" | "proposals">): number[] {
  if (lookOf(b) !== "displaced" || p.proposals[b.id] !== undefined) return [];
  return (p.offers[b.id]?.starts ?? []).filter((s) => s !== b.start);
}

export const offerId = (bookingId: string, start: number) => `offer:${bookingId}:${start}`;

export function buildEvents(p: EventsInput, rows: Set<string>, now: number): EventData[] {
  const a = axisOf(p);
  const out: EventData[] = [];
  const place = (start: number, end: number, staffId: string) => {
    const { key, date } = toAxis(start, p.timeZone, a);
    const id = rowId(key, staffId);
    return rows.has(id) ? { resourceId: id, startDate: date, endDate: new Date(date.getTime() + (end - start)) } : null;
  };
  for (const b of p.bookings) {
    const at = place(b.start, b.end, b.staffId);
    if (at) {
      out.push({
        id: b.id,
        ...at,
        name: `${b.clientName ?? "Slot on hold"}, ${b.serviceName}`,
        draggable: movable(b),
        resizable: false,
        kind: "booking",
        bookingId: b.id,
        look: lookOf(b),
        flash: (p.flash[b.id] ?? 0) > now,
        agent: p.agentChanges[b.id] !== undefined,
        fading: false,
        sig: `${b.status}|${b.start}|${b.end}|${b.paymentStatus}|${b.refundStatus}|${lookLabel(b)}|${b.clientName ?? ""}|${b.holdExpiresAt ?? ""}|${p.agentChanges[b.id]?.at ?? ""}`,
      });
    }
    for (const start of offeredStarts(b, p)) {
      const offer = place(start, start + (b.end - b.start), b.staffId);
      if (!offer) continue;
      out.push({
        id: offerId(b.id, start),
        ...offer,
        name: `Offered: ${b.clientName ?? ""}`,
        draggable: false,
        resizable: false,
        kind: "offer",
        offerStart: start,
        bookingId: b.id,
        look: "offer",
        flash: false,
        agent: false,
        fading: false,
        sig: String(start),
      });
    }
    const proposed = p.proposals[b.id];
    if (proposed === undefined || !movable(b)) continue;
    const ghost = place(proposed, proposed + (b.end - b.start), b.staffId);
    if (ghost) {
      out.push({
        id: `ghost:${b.id}`,
        ...ghost,
        name: `Proposed: ${b.clientName ?? ""}`,
        draggable: false,
        resizable: false,
        kind: "ghost",
        bookingId: b.id,
        look: "ghost",
        flash: false,
        agent: false,
        fading: false,
        sig: String(proposed),
      });
    }
  }
  return out;
}

/** A read-only dependency line from a booking to a time it may move to: an offer of the receptionist, or a proposal. */
export type DependencyData = { id: string; from: string; to: string; cls: string };

/** One line per offer or proposal whose booking is on screen too. */
export function buildDependencies(events: readonly EventData[]): DependencyData[] {
  const shown = new Set(events.filter((e) => e.kind === "booking").map((e) => e.id));
  return events.flatMap((e) =>
    e.kind !== "booking" && shown.has(e.bookingId) ? [{ id: `dep:${e.id}`, from: e.bookingId, to: e.id, cls: e.kind === "offer" ? "kt-dep kt-dep-offer" : "kt-dep kt-dep-proposal" }] : [],
  );
}

/** Money per row (appointment day × staff), counted like the Money tab: captured, refunded, paid out, in cents. */
export function rowMoney(rows: readonly Row[], bookings: readonly CalBooking[], timeZone: string): Map<string, { captured: number; refunded: number; paidOut: number }> {
  const out = new Map(rows.map((r) => [r.id, { captured: 0, refunded: 0, paidOut: 0 }]));
  for (const b of bookings) {
    const sum = out.get(rowId(dayKey(b.start, timeZone), b.staffId));
    if (!sum) continue;
    const m = bookingMoneyCents(b);
    sum.captured += m.captured;
    sum.refunded += m.refunded;
    sum.paidOut += m.paidOut;
  }
  return out;
}

export type RangeData = { id: string; resourceId: string; startDate: Date; endDate: Date; name: string; cls: string };

/**
 * Everything drawn behind the bookings, per row: hours she is closed (shaded), blocked time (hatched, labelled), a
 * "Free all day" note on an open day with nothing in it, and the "now" line in today's rows.
 */
export function buildRanges(
  p: LayoutInput & {
    bookings: CalBooking[];
    blocks: CalBlock[];
    hours: Record<string, OpenHours>;
    proposals: Record<string, number>;
    flash: Record<string, number>;
    offers?: Record<string, CascadeOffer>;
  },
  rows: Row[],
  now: number,
): RangeData[] {
  const a = axisOf(p);
  const from = AXIS.from * 60;
  const to = AXIS.to * 60;
  const out: RangeData[] = [];
  const range = (id: string, resourceId: string, start: number, end: number, name: string, cls: string) => {
    const s = Math.max(from, start);
    const e = Math.min(to, end);
    if (e > s) out.push({ id, resourceId, startDate: axisDate(a, s), endDate: axisDate(a, e), name, cls });
  };

  for (const row of rows) {
    const hours = p.hours[row.dayKey];
    if (hours === null) range(`off:${row.id}:closed`, row.id, from, to, "Closed", "kt-off kt-off-closed");
    else if (hours) {
      range(`off:${row.id}:before`, row.id, from, hours.open, "", "kt-off");
      range(`off:${row.id}:after`, row.id, hours.close, to, "", "kt-off");
      hours.breaks.forEach((b, i) => range(`off:${row.id}:break${i}`, row.id, b.from, b.to, "Break", "kt-off kt-off-break"));
    }

    const dayEnd = addDays(row.day, 1, p.timeZone);
    let blocked = false;
    for (const block of p.blocks) {
      if (block.staffId && block.staffId !== row.staffId) continue;
      const s = Math.max(block.start, row.day);
      const e = Math.min(block.end, dayEnd);
      if (e <= s) continue;
      blocked = true;
      const flash = (p.flash[block.id] ?? 0) > now;
      range(
        `block:${block.id}:${row.id}`,
        row.id,
        s === row.day ? 0 : minutesOf(s, p.timeZone),
        e === dayEnd ? 24 * 60 : minutesOf(e, p.timeZone),
        block.label ?? "Blocked",
        flash ? "kt-block kt-block-new" : "kt-block",
      );
    }

    const busy = p.bookings.some((b) => {
      if (b.staffId !== row.staffId) return false;
      const proposed = p.proposals[b.id];
      const offered = offeredStarts(b, { offers: p.offers ?? {}, proposals: p.proposals }).some((o) => o < dayEnd && o >= row.day);
      return (occupies(b) && b.start < dayEnd && b.end > row.day) || (proposed !== undefined && proposed < dayEnd && proposed >= row.day) || offered;
    });
    if (hours && !busy && !blocked) range(`free:${row.id}`, row.id, hours.open, hours.close, "Free all day", "kt-free");

    if (row.today) {
      const m = minutesOf(now, p.timeZone);
      if (m >= from && m < to) range(`now:${row.id}`, row.id, m, m + 1, "", "kt-now");
    }
  }
  return out;
}

/** The row header's second line: "3 bookings", "Closed", "Time blocked", "Free all day". */
export function rowSummary(row: Row, p: { bookings: CalBooking[]; blocks: CalBlock[]; hours: Record<string, OpenHours>; timeZone: string }): string {
  const dayEnd = addDays(row.day, 1, p.timeZone);
  const n = p.bookings.filter((b) => b.staffId === row.staffId && occupies(b) && b.start >= row.day && b.start < dayEnd).length;
  if (n > 0) return `${n} booking${n === 1 ? "" : "s"}`;
  if (p.hours[row.dayKey] === null) return "Closed";
  if (p.blocks.some((b) => (!b.staffId || b.staffId === row.staffId) && b.start < dayEnd && b.end > row.day)) return "Time blocked";
  return "Free all day";
}

/** "09:00–19:00" for the row header, when known. */
export function openLabel(open: OpenHours | undefined): string | null {
  if (!open) return null;
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${clock(open.open)}–${clock(open.close)}`;
}

/** "Thu 29 Oct · 14:00–15:30" for the drag tooltip. */
export function dropLabel(start: number, end: number, timeZone: string): string {
  return `${formatDay(start, timeZone)} · ${formatClock(start, timeZone)}–${formatClock(end, timeZone)}`;
}

// ---- bookable starts: drop targets while dragging, ticks at rest -----------------------------------------------

/** Said when a drop lands away from every highlighted start (never "slot unavailable"). */
export const PICK_HIGHLIGHTED = "Pick a highlighted time";

/** How far from a highlighted start a drop still snaps to it (outside its zone). */
export const SNAP_MS = 45 * 60_000;

/** A start the dragged booking can move to, with the zone drawn for it on the calendar. */
export type DropZone = { start: number; end: number; rowId: string };

/**
 * One honey zone per valid start of the dragged booking, in its staff member's rows: from the start to the booking's
 * length, or to the next start when that comes sooner (so dense starts read as one band and fixed ones as islands).
 * A drop anywhere inside a zone means that start.
 */
export function dropZones(p: { timeZone: string }, starts: readonly number[], lengthMs: number, staffId: string): DropZone[] {
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  return sorted.map((start, i) => {
    const key = dayKey(start, p.timeZone);
    const next = sorted[i + 1];
    const sameDay = next !== undefined && dayKey(next, p.timeZone) === key;
    return { start, end: Math.min(start + lengthMs, sameDay ? next : Infinity), rowId: rowId(key, staffId) };
  });
}

/** The drop zones as resource time ranges (only rows on screen). */
export function zoneRanges(p: LayoutInput, rows: Set<string>, zones: readonly DropZone[]): RangeData[] {
  const a = axisOf(p);
  return zones.flatMap((z) => {
    if (!rows.has(z.rowId)) return [];
    const from = Math.max(AXIS.from * 60, minutesOf(z.start, p.timeZone));
    const to = Math.min(AXIS.to * 60, from + Math.round((z.end - z.start) / 60_000));
    if (to <= from) return [];
    return [{ id: `target:${z.rowId}:${z.start}`, resourceId: z.rowId, startDate: axisDate(a, from), endDate: axisDate(a, to), name: formatClock(z.start, p.timeZone), cls: "kt-target" }];
  });
}

/**
 * Where a drop at `wanted` in row `rowIdOf` lands: the zone it falls in, else the nearest start of that row within
 * SNAP_MS, else null (the drop is refused: "Pick a highlighted time").
 */
export function snapDrop(zones: readonly DropZone[], rowIdOf: string, wanted: number): number | null {
  const row = zones.filter((z) => z.rowId === rowIdOf);
  const inside = row.find((z) => wanted >= z.start && wanted < z.end);
  if (inside) return inside.start;
  let best: DropZone | null = null;
  for (const z of row) if (Math.abs(z.start - wanted) <= SNAP_MS && (!best || Math.abs(z.start - wanted) < Math.abs(best.start - wanted))) best = z;
  return best?.start ?? null;
}

/** "Aïcha offers 09:00 · 13:00 · 15:30 starts" for one row, or what to do when that day has none. */
export function offerLabel(staffName: string, zones: readonly DropZone[], rowIdOf: string, timeZone: string): string {
  const times = zones.filter((z) => z.rowId === rowIdOf).map((z) => formatClock(z.start, timeZone));
  if (times.length === 0) return zones.length ? `${staffName} has no free start this day · pick a highlighted time` : `${staffName} has no free start this week`;
  if (times.length > 6) return `${staffName} can start from ${times[0]} to ${times.at(-1)} · pick a highlighted time`;
  return `${staffName} offers ${times.join(" · ")} start${times.length === 1 ? "" : "s"}`;
}

/** A start a new booking could take, per staff (her shortest service fits). */
export type Tick = { start: number; staffId: string };

/** More ticks than this in a row: no time labels, just the marks. */
const TICK_LABELS_MAX = 6;

/** The at-rest ticks: a small honey mark at each bookable start, labelled when the row has only a few. */
export function tickRanges(p: LayoutInput, rows: Set<string>, ticks: readonly Tick[]): RangeData[] {
  const a = axisOf(p);
  const byRow = new Map<string, number[]>();
  for (const t of ticks) {
    const id = rowId(dayKey(t.start, p.timeZone), t.staffId);
    if (!rows.has(id)) continue;
    const list = byRow.get(id) ?? [];
    list.push(t.start);
    byRow.set(id, list);
  }
  const out: RangeData[] = [];
  for (const [id, starts] of byRow) {
    const labelled = starts.length <= TICK_LABELS_MAX;
    for (const start of starts) {
      const m = minutesOf(start, p.timeZone);
      if (m < AXIS.from * 60 || m >= AXIS.to * 60) continue;
      out.push({
        id: `tick:${id}:${start}`,
        resourceId: id,
        startDate: axisDate(a, m),
        endDate: axisDate(a, m + 1),
        name: labelled ? formatClock(start, p.timeZone) : "",
        cls: labelled ? "kt-tick kt-tick-label" : "kt-tick",
      });
    }
  }
  return out;
}
