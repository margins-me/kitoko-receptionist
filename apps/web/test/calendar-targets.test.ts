import { describe, expect, it } from "vitest";
import { dropZones, offerLabel, PICK_HIGHLIGHTED, rowId, SNAP_MS, snapDrop, tickRanges } from "../src/components/dashboard/calendar-layout";
import { zonedToEpoch } from "../src/components/dashboard/time";

const tz = "Europe/Rome";
const at = (day: number, hour: number, minute = 0) => zonedToEpoch({ year: 2026, month: 10, day, hour, minute }, tz);
const MIN = 60_000;

describe("drop targets of a dragged booking", () => {
  // Aïcha's fixed starts on Thursday 29 October, a 90-minute Cornrows.
  const zones = dropZones({ timeZone: tz }, [at(29, 15, 30), at(29, 9), at(29, 13)], 90 * MIN, "s1");
  const row = rowId("2026-10-29", "s1");

  it("draws one zone per start, as long as the booking, in her row of that day", () => {
    expect(zones.map((z) => [z.start, z.end - z.start, z.rowId])).toEqual([
      [at(29, 9), 90 * MIN, row],
      [at(29, 13), 90 * MIN, row],
      [at(29, 15, 30), 90 * MIN, row],
    ]);
  });

  it("stops a zone at the next start, so dense starts read as one band", () => {
    const dense = dropZones({ timeZone: tz }, [at(29, 10), at(29, 10, 30), at(29, 11)], 120 * MIN, "s1");
    expect(dense.map((z) => (z.end - z.start) / MIN)).toEqual([30, 30, 120]);
  });

  it("snaps a drop inside a zone, or within 45 minutes of a start, to that start", () => {
    expect(snapDrop(zones, row, at(29, 14, 15))).toBe(at(29, 13));
    expect(snapDrop(zones, row, at(29, 12, 30))).toBe(at(29, 13));
    expect(snapDrop(zones, row, at(29, 9) - SNAP_MS)).toBe(at(29, 9));
  });

  it("refuses a drop far from every start, or in another row", () => {
    expect(snapDrop(zones, row, at(29, 11, 45))).toBeNull();
    expect(snapDrop(zones, rowId("2026-10-30", "s1"), at(30, 13))).toBeNull();
    expect(snapDrop(zones, rowId("2026-10-29", "s2"), at(29, 13))).toBeNull();
    expect(PICK_HIGHLIGHTED).toBe("Pick a highlighted time");
  });

  it("names her starts for the tooltip", () => {
    expect(offerLabel("Aïcha", zones, row, tz)).toBe("Aïcha offers 09:00 · 13:00 · 15:30 starts");
    expect(offerLabel("Aïcha", zones, rowId("2026-10-30", "s1"), tz)).toBe("Aïcha has no free start this day · pick a highlighted time");
    expect(offerLabel("Aïcha", [], row, tz)).toBe("Aïcha has no free start this week");
  });
});

describe("bookable ticks at rest", () => {
  const layout = { staff: [], timeZone: tz, weekStart: at(26, 0), zoom: "week" as const, focusDay: at(26, 0) };

  it("marks each bookable start in its row, labelled when the row has a few", () => {
    const rows = new Set([rowId("2026-10-29", "s1"), rowId("2026-10-30", "s1")]);
    const few = [at(29, 9), at(29, 13)].map((start) => ({ start, staffId: "s1" }));
    const many = Array.from({ length: 8 }, (_, i) => ({ start: at(30, 9) + i * 30 * MIN, staffId: "s1" }));
    const other = { start: at(29, 9), staffId: "s2" };
    const ranges = tickRanges(layout, rows, [...few, ...many, other]);
    expect(ranges).toHaveLength(10);
    expect(ranges.filter((r) => r.resourceId === rowId("2026-10-29", "s1")).map((r) => [r.name, r.cls])).toEqual([
      ["09:00", "kt-tick kt-tick-label"],
      ["13:00", "kt-tick kt-tick-label"],
    ]);
    expect(ranges.filter((r) => r.resourceId === rowId("2026-10-30", "s1")).every((r) => r.name === "" && r.cls === "kt-tick")).toBe(true);
  });
});
