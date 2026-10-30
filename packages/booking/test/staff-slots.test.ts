import { describe, expect, it } from "vitest";
import { daySlots, staffSlots } from "../src/slots";
import type { Interval } from "../src/slots";
import { TZ, paris, schedule } from "./fixtures";

// The Nala schedule: Monday starts at 09:00, 13:00 and 15:30; a 90 min session fits each of them.
const monday = "2026-11-02";
const sunday = "2026-11-08";
const at = (time: string) => paris(monday, time);
const busy = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });
const base = {
  tz: TZ,
  schedule,
  busy: [] as Interval[],
  minutes: 90,
  now: paris("2026-10-18", "12:00"),
  window: { until: "2026-12-31" },
  date: monday,
};
const free = (r: ReturnType<typeof staffSlots>) => r.slots.map((s) => [s.time, s.staffIds]);

describe("staffSlots", () => {
  it("lists every eligible staff at each start when nobody is busy", () => {
    const r = staffSlots({ ...base, staffIds: ["awa", "binta"], staffBusy: {} });
    expect(r.state).toBe("open");
    expect(free(r)).toEqual([
      ["09:00", ["awa", "binta"]],
      ["13:00", ["awa", "binta"]],
      ["15:30", ["awa", "binta"]],
    ]);
    expect(r.slots[0]).toMatchObject({ start: at("09:00"), end: at("10:30") });
  });

  it("drops a staff from the starts her own bookings overlap", () => {
    const r = staffSlots({ ...base, staffIds: ["awa", "binta"], staffBusy: { awa: [busy("10:00", "11:00")] } });
    expect(free(r)).toEqual([
      ["09:00", ["binta"]],
      ["13:00", ["awa", "binta"]],
      ["15:30", ["awa", "binta"]],
    ]);
  });

  it("hides a start as taken when no eligible staff is free at it", () => {
    const r = staffSlots({
      ...base,
      staffIds: ["awa", "binta"],
      staffBusy: { awa: [busy("13:00", "14:00")], binta: [busy("14:00", "15:00")] },
    });
    expect(free(r).map(([time]) => time)).toEqual(["09:00", "15:30"]);
    expect(r.hidden).toEqual([{ time: "13:00", reason: "taken" }]);
  });

  it("applies whole-business blocks to everyone", () => {
    const r = staffSlots({ ...base, busy: [busy("15:00", "19:00")], staffIds: ["awa", "binta"], staffBusy: {} });
    expect(free(r).map(([time]) => time)).toEqual(["09:00", "13:00"]);
    expect(r.hidden).toEqual([{ time: "15:30", reason: "taken" }]);
  });

  it("only offers the staff eligible for the service, in the order given", () => {
    const r = staffSlots({ ...base, staffIds: ["chioma", "awa"], staffBusy: { binta: [], awa: [busy("09:00", "09:30")] } });
    expect(free(r)).toEqual([
      ["09:00", ["chioma"]],
      ["13:00", ["chioma", "awa"]],
      ["15:30", ["chioma", "awa"]],
    ]);
  });

  it("is full without any eligible staff", () => {
    const r = staffSlots({ ...base, staffIds: [], staffBusy: {} });
    expect(r.state).toBe("full");
    expect(r.slots).toEqual([]);
    expect(r.hidden.map((h) => h.reason)).toEqual(["taken", "taken", "taken"]);
  });

  it("keeps the day's own state when the day has no start at all", () => {
    expect(staffSlots({ ...base, date: sunday, staffIds: ["awa"], staffBusy: {} }).state).toBe("closed");
    expect(staffSlots({ ...base, date: "2026-10-01", staffIds: ["awa"], staffBusy: {} }).state).toBe("past");
  });

  it("is the union of each staff's daySlots", () => {
    const shared = [busy("18:00", "19:00")];
    const staffBusy = { awa: [busy("09:30", "10:00")], binta: [busy("12:00", "13:30"), busy("16:00", "16:30")], chioma: [] };
    const staffIds = ["awa", "binta", "chioma"];
    const r = staffSlots({ ...base, minutes: 60, busy: shared, staffIds, staffBusy });
    const perStaff = staffIds.map((id) => ({ id, times: daySlots({ ...base, minutes: 60, busy: [...shared, ...staffBusy[id as keyof typeof staffBusy]] }).slots.map((s) => s.time) }));
    const union = [...new Set(perStaff.flatMap((s) => s.times))].sort();
    expect(r.slots.map((s) => s.time)).toEqual(union);
    for (const slot of r.slots) expect(slot.staffIds).toEqual(perStaff.filter((s) => s.times.includes(slot.time)).map((s) => s.id));
  });
});
