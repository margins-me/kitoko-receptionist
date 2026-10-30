import { describe, expect, it } from "vitest";
import { AddonSchema, DayHoursSchema, OptionGroupSchema, RulesSchema, ScheduleSchema } from "../src/schemas";
import { rules, schedule, services, withConditions } from "./fixtures";

describe("fixtures match the JSONB contract", () => {
  it("parses rules and schedule", () => {
    expect(RulesSchema.parse(rules)).toEqual(rules);
    expect(ScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it("parses every option group and add-on", () => {
    for (const s of [...services, withConditions]) {
      for (const g of s.optionGroups) expect(OptionGroupSchema.parse(g)).toEqual(g);
      for (const a of s.addons) expect(AddonSchema.parse(a)).toEqual(a);
    }
  });

  it("rejects opening hours where open is not before close", () => {
    expect(DayHoursSchema.safeParse({ open: "19:00", close: "09:00", breaks: [] }).success).toBe(false);
    expect(DayHoursSchema.safeParse({ open: "09:00", close: "09:00", breaks: [] }).success).toBe(false);
  });

  it("rejects duplicate start times", () => {
    const day = { open: "09:00", close: "19:00", breaks: [], starts: ["09:00", "09:00"] };
    expect(DayHoursSchema.safeParse(day).success).toBe(false);
  });
});
