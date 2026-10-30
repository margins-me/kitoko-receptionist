import { describe, expect, it } from "vitest";
import { addDays, localDate, resolveLocal, weekdayOf } from "../src/time";
import { TZ } from "./fixtures";

describe("resolveLocal in Europe/Paris across 2026 DST changes", () => {
  it("resolves wall times on both sides of each change", () => {
    expect(resolveLocal("2026-03-28", "09:00", TZ)).toEqual({ at: Date.UTC(2026, 2, 28, 8), skipped: false });
    expect(resolveLocal("2026-03-29", "09:00", TZ)).toEqual({ at: Date.UTC(2026, 2, 29, 7), skipped: false });
    expect(resolveLocal("2026-10-24", "09:00", TZ)).toEqual({ at: Date.UTC(2026, 9, 24, 7), skipped: false });
    expect(resolveLocal("2026-10-25", "09:00", TZ)).toEqual({ at: Date.UTC(2026, 9, 25, 8), skipped: false });
  });

  it("flags a wall time that does not exist (spring forward)", () => {
    expect(resolveLocal("2026-03-29", "02:30", TZ).skipped).toBe(true);
  });

  it("resolves an ambiguous wall time to the earlier offset (fall back)", () => {
    expect(resolveLocal("2026-10-25", "02:30", TZ)).toEqual({ at: Date.UTC(2026, 9, 25, 0, 30), skipped: false });
  });
});

describe("calendar helpers", () => {
  it("reads the local date of an instant", () => {
    expect(localDate(Date.UTC(2026, 9, 31, 23, 30), TZ)).toBe("2026-11-01");
    expect(localDate(Date.UTC(2026, 9, 31, 22, 59), TZ)).toBe("2026-10-31");
  });

  it("adds days and names weekdays", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(weekdayOf("2026-11-02")).toBe("mon");
    expect(weekdayOf("2026-11-08")).toBe("sun");
  });
});
