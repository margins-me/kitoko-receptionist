import { describe, expect, it } from "vitest";
import { cancellationRule, cityMatches, dayCount, inTimeOfDay, localRange, localTime, serviceMatches, tradesOf } from "../src/format";
import type { Rules } from "@kitoko/booking";

describe("search matching", () => {
  it("matches cities by name, alias, case and accents", () => {
    expect(cityMatches("Milan", "milan")).toBe(true);
    expect(cityMatches("Milan", "Milano")).toBe(true);
    expect(cityMatches("Milan", "Milan, Italy")).toBe(true);
    expect(cityMatches("London", "Londres")).toBe(true);
    expect(cityMatches("Lyon", "Milan")).toBe(false);
    expect(cityMatches(null, "Milan")).toBe(false);
  });

  it("matches a service when every word of the query is in its name", () => {
    expect(serviceMatches("Knotless braids", "knotless braids")).toBe(true);
    expect(serviceMatches("Knotless braids", "Knotless braid")).toBe(true);
    expect(serviceMatches("Box braids", "knotless braids")).toBe(false);
    expect(serviceMatches("Box braids", "braids")).toBe(true);
  });

  it("maps everyday words to trade ids", () => {
    expect(tradesOf("box braids")).toEqual(["tresses"]);
    expect(tradesOf("gel nails")).toEqual(["ongles"]);
    expect(tradesOf("something else")).toEqual([]);
  });
});

describe("dates", () => {
  it("turns local dates into an instant range in the pro's time zone", () => {
    const { from, to } = localRange("2026-11-07", "2026-11-07", "Europe/Rome");
    expect(new Date(from).toISOString()).toBe("2026-11-06T23:00:00.000Z");
    expect(to - from).toBe(86_400_000);
    expect(dayCount("2026-11-01", "2026-11-14")).toBe(14);
  });

  it("formats a local time", () => {
    expect(localTime(Date.parse("2026-11-07T09:00:00Z"), "Europe/Rome")).toBe("Sat 7 Nov, 10:00");
  });
});

describe("search_pros details", () => {
  const rules: Rules = {
    deposit: { mode: "fixed", cents: 3000 },
    feePayer: "client",
    reschedule: { maxCount: 1, minHoursBefore: 48 },
    cancellation: [
      { minHoursBefore: 48, keepPercent: 0 },
      { minHoursBefore: 0, keepPercent: 100 },
    ],
    lateness: { graceMinutes: 15, feeCents: 500, autoCancelAfterMinutes: 30 },
    balanceMethods: ["cash"],
    companionsAllowed: false,
    extra: [{ en: "Hair washed on arrival." }],
  } as Rules;

  it("writes the cancellation rule in one sentence, from @kitoko/booking", () => {
    expect(cancellationRule(rules, "EUR")).toMatch(/^Free cancellation up to 48\sh before; after that the deposit is kept\.$/);
    expect(cancellationRule({ ...rules, deposit: { mode: "none" } } as Rules, "EUR")).toBe("Nothing is paid online, so cancelling costs nothing.");
  });

  it("puts a start in the morning, afternoon or evening of the pro's time zone", () => {
    const at = (iso: string) => Date.parse(iso);
    // 09:00 and 12:00 in Milan (UTC+1 in November)
    expect(inTimeOfDay(at("2026-10-31T08:00:00Z"), "Europe/Rome", "morning")).toBe(true);
    expect(inTimeOfDay(at("2026-11-07T11:00:00Z"), "Europe/Rome", "morning")).toBe(false);
    expect(inTimeOfDay(at("2026-11-07T11:00:00Z"), "Europe/Rome", "afternoon")).toBe(true);
    expect(inTimeOfDay(at("2026-11-07T17:30:00Z"), "Europe/Rome", "evening")).toBe(true);
    expect(inTimeOfDay(at("2026-11-07T17:30:00Z"), "Europe/Rome", "any")).toBe(true);
  });
});
