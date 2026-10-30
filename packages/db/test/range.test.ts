import { describe, expect, it } from "vitest";
import { formatRange, parseRange } from "../src/range";

describe("ranges", () => {
  it("parses ranges as Postgres prints them", () => {
    expect(parseRange('["2030-01-07 10:00:00+00","2030-01-07 11:30:00+00")')).toEqual({
      start: Date.UTC(2030, 0, 7, 10),
      end: Date.UTC(2030, 0, 7, 11, 30),
    });
    expect(parseRange('["2030-01-07 10:00:00.5+01","2030-01-07 11:00:00+05:30")')).toEqual({
      start: Date.UTC(2030, 0, 7, 9, 0, 0, 500),
      end: Date.UTC(2030, 0, 7, 5, 30),
    });
  });

  it("round-trips formatRange", () => {
    const start = Date.UTC(2030, 5, 1, 8, 15);
    const end = start + 90 * 60_000;
    expect(formatRange(start, end)).toBe("[2030-06-01T08:15:00.000Z,2030-06-01T09:45:00.000Z)");
    expect(parseRange(formatRange(start, end).replace(/T/g, " ").replace(/\.000Z/g, "+00"))).toEqual({ start, end });
  });

  it("refuses an open or inclusive range", () => {
    expect(() => parseRange("[2030-01-07 10:00:00+00,)")).toThrow();
    expect(() => parseRange('["2030-01-07 10:00:00+00","2030-01-07 11:00:00+00"]')).toThrow();
  });
});
