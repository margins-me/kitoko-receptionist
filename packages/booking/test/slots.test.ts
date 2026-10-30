import { describe, expect, it } from "vitest";
import type { DayHours } from "../src/schemas";
import { bookableUntil, daySlots, weekSlots } from "../src/slots";
import type { DayResult, Interval } from "../src/slots";
import { TZ, paris, schedule } from "./fixtures";

const monday = "2026-11-02";
const base = {
  tz: TZ,
  schedule,
  busy: [] as Interval[],
  now: paris("2026-10-18", "12:00"),
  window: { until: "2026-12-31" },
};
const day = (date: string, minutes: number, extra: Partial<Parameters<typeof daySlots>[0]> = {}) =>
  daySlots({ ...base, date, minutes, ...extra });
const times = (r: DayResult) => r.slots.map((s) => s.time);
const stepDay: DayHours = { open: "09:00", close: "19:00", breaks: [] };

describe("daySlots", () => {
  it("offers only start times where the whole session fits", () => {
    const r = day(monday, 455);
    expect(r.state).toBe("open");
    expect(r.close).toBe("19:00");
    expect(times(r)).toEqual(["09:00"]);
    expect(r.hidden).toEqual([
      { time: "13:00", reason: "ends_after_close" },
      { time: "15:30", reason: "ends_after_close" },
    ]);
  });

  it("ends a 6 h 15 session at 15:15", () => {
    expect(day(monday, 375).slots[0]).toEqual({
      time: "09:00",
      start: paris(monday, "09:00"),
      end: paris(monday, "15:15"),
    });
  });

  it("allows a session ending exactly at close", () => {
    const r = day("2026-11-07", 240);
    expect(times(r)).toEqual(["09:00", "13:00"]);
    expect(r.slots[1]?.end).toBe(paris("2026-11-07", "17:00"));
    expect(r.close).toBe("17:00");
  });

  it("steps through the day when the pro sets no start times", () => {
    const r = day(monday, 90, { override: stepDay });
    expect(times(r)).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00",
      "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
    ]);
    expect(r.hidden).toEqual([
      { time: "18:00", reason: "ends_after_close" },
      { time: "18:30", reason: "ends_after_close" },
    ]);
  });

  it("hides starts that overlap a break, touching it is fine", () => {
    const r = day(monday, 90, { override: { ...stepDay, breaks: [{ from: "12:00", to: "13:00" }] } });
    expect(times(r)).toContain("10:30");
    expect(times(r)).toContain("13:00");
    expect(r.hidden.filter((h) => h.reason === "overlaps_break").map((h) => h.time)).toEqual([
      "11:00", "11:30", "12:00", "12:30",
    ]);
  });

  it("hides starts that overlap busy time, touching it is fine", () => {
    const busy = [{ start: paris(monday, "09:00"), end: paris(monday, "15:15") }];
    const long = day(monday, 375, { busy });
    expect(long.state).toBe("full");
    expect(long.hidden[0]).toEqual({ time: "09:00", reason: "taken" });

    const short = day(monday, 90, { busy });
    expect(short.hidden).toEqual([
      { time: "09:00", reason: "taken" },
      { time: "13:00", reason: "taken" },
    ]);
    expect(times(short)).toEqual(["15:30"]);

    const morning = [{ start: paris(monday, "09:00"), end: paris(monday, "13:00") }];
    expect(times(day(monday, 90, { busy: morning }))).toEqual(["13:00", "15:30"]);
  });

  it("follows the weekly schedule and day overrides", () => {
    const sunday = day("2026-11-08", 90);
    expect(sunday).toEqual({ date: "2026-11-08", state: "closed", slots: [], hidden: [] });

    const opened = day("2026-11-08", 90, { override: { open: "10:00", close: "16:00", breaks: [], starts: ["10:00"] } });
    expect(opened.state).toBe("open");
    expect(times(opened)).toEqual(["10:00"]);
    expect(opened.close).toBe("16:00");

    expect(day("2026-11-03", 90, { override: null }).state).toBe("closed");
  });

  it("is full when nothing fits, and says why", () => {
    const busy = [{ start: paris(monday, "09:00"), end: paris(monday, "19:00") }];
    const taken = day(monday, 90, { busy });
    expect(taken.state).toBe("full");
    expect(taken.slots).toEqual([]);
    expect(taken.hidden.map((h) => h.reason)).toEqual(["taken", "taken", "taken"]);

    const tooLong = day(monday, 660);
    expect(tooLong.state).toBe("full");
    expect(tooLong.hidden.map((h) => h.reason)).toEqual(["ends_after_close", "ends_after_close", "ends_after_close"]);
  });

  it("drops start times that are already gone", () => {
    const afternoon = day(monday, 90, { now: paris(monday, "14:00") });
    expect(afternoon.state).toBe("open");
    expect(times(afternoon)).toEqual(["15:30"]);
    expect(afternoon.hidden).toEqual([]);

    expect(day(monday, 90, { now: paris(monday, "16:00") })).toEqual({
      date: monday,
      state: "past",
      close: "19:00",
      slots: [],
      hidden: [],
    });
    expect(day("2026-10-30", 90, { now: paris(monday, "08:00") }).state).toBe("past");
  });

  it("respects the booking window", () => {
    const window = { until: "2026-10-31" };
    expect(day("2026-10-31", 90, { window }).state).toBe("open");
    expect(day("2026-11-01", 90, { window }).state).toBe("beyond_window");
  });

  it("keeps the absolute duration on the fall-back day", () => {
    const r = day("2026-10-25", 375, { override: { ...stepDay, starts: ["09:00"] } });
    const slot = r.slots[0]!;
    expect(slot.start).toBe(Date.UTC(2026, 9, 25, 8));
    expect(slot.end - slot.start).toBe(375 * 60_000);
  });

  it("skips start times that do not exist on the spring-forward day", () => {
    const r = day("2026-03-29", 60, {
      now: Date.UTC(2026, 2, 1),
      override: { open: "01:00", close: "06:00", breaks: [], starts: ["02:30", "03:00"] },
    });
    expect(times(r)).toEqual(["03:00"]);
    expect(r.hidden).toEqual([]);
  });

  it("measures the fit in real minutes across the spring-forward change", () => {
    const night = { open: "01:00", close: "06:00", breaks: [], starts: ["01:00"] };
    const now = Date.UTC(2026, 2, 1);
    // 01:00 to 06:00 looks like 5 h on the clock but is only 4 h that night.
    expect(times(day("2026-03-29", 240, { now, override: night }))).toEqual(["01:00"]);
    expect(day("2026-03-29", 300, { now, override: night }).hidden).toEqual([
      { time: "01:00", reason: "ends_after_close" },
    ]);
  });
});

describe("bookableUntil", () => {
  const opensAt = paris("2026-10-25", "20:00");
  const opening = { opensAt, until: "2026-11-30" };
  const window = { kind: "until", date: "2026-10-31" } as const;

  it("announces an opening that has not happened yet", () => {
    expect(opensAt).toBe(Date.UTC(2026, 9, 25, 19));
    const w = bookableUntil({ now: opensAt - 1, tz: TZ, window, openings: [opening] });
    expect(w).toEqual({ until: "2026-10-31", next: opening });
    expect(day(monday, 90, { now: opensAt - 1, window: w })).toEqual({
      date: monday,
      state: "not_open_yet",
      opensAt,
      slots: [],
      hidden: [],
    });
    expect(day("2026-12-01", 90, { now: opensAt - 1, window: w }).state).toBe("beyond_window");
  });

  it("extends the window once the opening time is reached", () => {
    const w = bookableUntil({ now: opensAt, tz: TZ, window, openings: [opening] });
    expect(w).toEqual({ until: "2026-11-30" });
    expect(day(monday, 90, { now: opensAt, window: w }).state).toBe("open");
  });

  it("picks the earliest future opening that extends the window", () => {
    const later = { opensAt: opensAt + 86_400_000, until: "2026-12-31" };
    const shorter = { opensAt: opensAt - 86_400_000, until: "2026-10-30" };
    const w = bookableUntil({ now: opensAt - 2 * 86_400_000, tz: TZ, window, openings: [later, shorter, opening] });
    expect(w).toEqual({ until: "2026-10-31", next: opening });
  });

  it("rolls the window from today", () => {
    const now = paris("2026-10-18", "12:00");
    expect(bookableUntil({ now, tz: TZ, window: { kind: "rolling", days: 60 }, openings: [] })).toEqual({
      until: "2026-12-17",
    });
  });
});

describe("weekSlots", () => {
  it("returns one result per day with overrides applied", () => {
    const week = weekSlots({ ...base, minutes: 90, from: monday, days: 7, overrides: { "2026-11-03": null } });
    expect(week.map((d) => d.date)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
    expect(week.map((d) => d.state)).toEqual(["open", "closed", "open", "open", "open", "open", "closed"]);
  });
});
