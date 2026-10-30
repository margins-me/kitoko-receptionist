import { describe, expect, it } from "vitest";
import { localDate } from "@kitoko/booking";
import { listBookings } from "@kitoko/db";
import { moveTargets } from "../src/services/booking";
import { bookableStarts } from "../src/services/calendar";
import { AICHA, DAY, KEMI, testCtx } from "./fixtures";

// Read-only: nothing here writes, so the demo week stays as the other suites (and a running e2e) left it.
const ctx = testCtx();
const tz = "Europe/Rome";
/** Aïcha's fixed starts (seed): 09:00, 13:00, 15:30 on weekdays; 09:00, 13:00 at weekends. */
const AICHA_STARTS = new Set(["09:00", "13:00", "15:30"]);
const localTimeOf = (at: number, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

describe("calendar: drop targets and bookable ticks", () => {
  it("moveTargets offers a confirmed booking only her fixed starts that are free, never its own time", async () => {
    const now = Date.now();
    const booked = await listBookings(ctx.db, AICHA, now + DAY, now + 14 * DAY, { statuses: ["confirmed"] });
    const booking = booked[0];
    if (!booking) throw new Error("no confirmed Aïcha booking in the next two weeks: reset the demo");
    const r = await moveTargets(ctx, { bookingId: booking.id, from: now, to: now + 14 * DAY });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.length).toBeGreaterThan(0);
    const length = booking.end - booking.start;
    const others = (await listBookings(ctx.db, AICHA, now, now + 15 * DAY, { statuses: ["held", "confirmed"] })).filter((b) => b.id !== booking.id && b.staffId === booking.staffId);
    for (const s of r.value) {
      const start = Date.parse(s.start);
      expect(AICHA_STARTS.has(localTimeOf(start, tz))).toBe(true);
      expect(start).not.toBe(booking.start);
      expect(Date.parse(s.end) - start).toBe(length);
      expect(others.some((o) => o.start < start + length && o.end > start)).toBe(false);
    }
  });

  it("moveTargets refuses a booking that cannot move", async () => {
    expect(await moveTargets(ctx, { bookingId: "00000000-0000-4000-8000-000000000000", from: Date.now(), to: Date.now() + DAY })).toEqual({ ok: false, error: "not_found" });
  });

  it("bookableStarts marks her fixed starts (Aïcha) and her 30-minute steps (Kemi), from now on", async () => {
    const now = Date.now();
    const aicha = await bookableStarts(ctx, { proId: AICHA, from: now - DAY, to: now + 7 * DAY });
    if (!aicha.ok) throw new Error(aicha.error);
    expect(aicha.value.length).toBeGreaterThan(0);
    for (const t of aicha.value) {
      expect(t.start).toBeGreaterThanOrEqual(now - 60_000);
      expect(AICHA_STARTS.has(localTimeOf(t.start, tz))).toBe(true);
    }
    const kemi = await bookableStarts(ctx, { proId: KEMI, from: now, to: now + 7 * DAY });
    if (!kemi.ok) throw new Error(kemi.error);
    expect(kemi.value.every((t) => Math.round(t.start / 60_000) % 30 === 0)).toBe(true);
    // Several starts a day: more than one tick on at least one day.
    const perDay = new Map<string, number>();
    for (const t of kemi.value) perDay.set(localDate(t.start, "Europe/London"), (perDay.get(localDate(t.start, "Europe/London")) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeGreaterThan(1);
  });

  it("bookableStarts rejects an empty range", async () => {
    expect(await bookableStarts(ctx, { proId: AICHA, from: 10, to: 10 })).toEqual({ ok: false, error: "invalid_dates" });
  });
});
