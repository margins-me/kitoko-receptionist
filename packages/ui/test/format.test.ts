import { describe, expect, it } from "vitest";
import { formatDuration, formatEur, formatMoney, formatTime } from "../src/format";

const nb = (s: string) => s.replaceAll(" ", " ");

describe("formatEur", () => {
  it("drops decimals on whole euros", () => {
    expect(formatEur(14500, "fr")).toBe(nb("145 €"));
    expect(formatEur(0, "fr-FR")).toBe(nb("0 €"));
  });
  it("keeps cents otherwise", () => {
    expect(formatEur(490, "fr")).toBe(nb("4,90 €"));
    expect(formatEur(1550, "fr-FR")).toBe(nb("15,50 €"));
  });
  it("groups thousands the way Intl does", () => {
    expect(formatEur(123456, "fr")).toBe("1 234,56 €");
  });
  it("formats English", () => {
    expect(formatEur(14500, "en")).toBe("€145");
    expect(formatEur(490, "en")).toBe("€4.90");
  });
  it("formats Italian", () => {
    expect(formatEur(14500, "it")).toBe(nb("145 €"));
    expect(formatEur(490, "it-IT")).toBe(nb("4,90 €"));
    expect(formatEur(1234567, "it")).toBe(nb("12.345,67 €"));
  });
  it("formats Spanish, grouping from five digits as Spanish does", () => {
    expect(formatEur(14500, "es")).toBe(nb("145 €"));
    expect(formatEur(490, "es-ES")).toBe(nb("4,90 €"));
    expect(formatEur(123456, "es")).toBe(nb("1234,56 €"));
    expect(formatEur(1234567, "es")).toBe(nb("12.345,67 €"));
  });
});

describe("formatMoney", () => {
  it("formats pounds with the plain sign in every language", () => {
    expect(formatMoney(2000, "en-GB", "GBP")).toBe("£20");
    expect(formatMoney(550, "en", "GBP")).toBe("£5.50");
    expect(formatMoney(2000, "fr", "GBP")).toBe(nb("20 £"));
    expect(formatMoney(2050, "es", "GBP")).toBe(nb("20,50 £"));
  });
  it("formats euros as formatEur does", () => {
    expect(formatMoney(14500, "fr", "EUR")).toBe(formatEur(14500, "fr"));
    expect(formatMoney(490, "en", "EUR")).toBe("€4.90");
  });
});

describe("formatDuration", () => {
  it("formats French", () => {
    expect(formatDuration(375, "fr")).toBe(nb("6 h 15"));
    expect(formatDuration(45, "fr")).toBe(nb("45 min"));
    expect(formatDuration(60, "fr")).toBe(nb("1 h"));
    expect(formatDuration(125, "fr")).toBe(nb("2 h 05"));
  });
  it("formats English", () => {
    expect(formatDuration(375, "en")).toBe(nb("6 h 15 min"));
    expect(formatDuration(45, "en")).toBe(nb("45 min"));
    expect(formatDuration(60, "en")).toBe(nb("1 h"));
  });
  it("formats Italian", () => {
    expect(formatDuration(375, "it")).toBe(nb("6 h 15 min"));
    expect(formatDuration(45, "it")).toBe(nb("45 min"));
    expect(formatDuration(60, "it-IT")).toBe(nb("1 h"));
    expect(formatDuration(125, "it")).toBe(nb("2 h 5 min"));
  });
  it("formats Spanish", () => {
    expect(formatDuration(375, "es")).toBe(nb("6 h 15 min"));
    expect(formatDuration(45, "es")).toBe(nb("45 min"));
    expect(formatDuration(60, "es-ES")).toBe(nb("1 h"));
    expect(formatDuration(125, "es")).toBe(nb("2 h 5 min"));
  });
});

describe("formatTime", () => {
  it("formats French", () => {
    expect(formatTime("09:00", "fr")).toBe(nb("9 h"));
    expect(formatTime("15:30", "fr")).toBe(nb("15 h 30"));
    expect(formatTime("09:05:00", "fr-FR")).toBe(nb("9 h 05"));
  });
  it("formats English", () => {
    expect(formatTime("09:00", "en")).toBe("9:00");
    expect(formatTime("15:30", "en")).toBe("15:30");
  });
  it("formats Italian", () => {
    expect(formatTime("09:00", "it")).toBe("9:00");
    expect(formatTime("15:30", "it")).toBe("15:30");
    expect(formatTime("09:05:00", "it-IT")).toBe("9:05");
  });
  it("formats Spanish", () => {
    expect(formatTime("09:00", "es")).toBe("9:00");
    expect(formatTime("15:30", "es")).toBe("15:30");
    expect(formatTime("09:05:00", "es-ES")).toBe("9:05");
  });
  it("rejects other shapes", () => {
    expect(() => formatTime("9h", "fr")).toThrow(RangeError);
  });
});
