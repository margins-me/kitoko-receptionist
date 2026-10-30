import { describe, expect, it } from "vitest";
import { buttonVars, contrast, customButtonVars, customTheme, customVars, normalizeHex, pageVars, THEME_IDS, THEMES, themeVars, type Theme } from "../src";

// The same six pairs as test/themes.test.ts, plus the white-surface button rule.
function check(t: Theme): string[] {
  const pairs: [string, string, string][] = [
    ["fg/bg", t.fg, t.bg],
    ["muted/bg", t.muted, t.bg],
    ["muted/chip", t.muted, t.chip],
    ["accent/bg", t.accent, t.bg],
    ["onAccent/accent", t.onAccent, t.accent],
    ["fg/chip", t.fg, t.chip],
  ];
  const fails = pairs.filter(([, a, b]) => contrast(a, b) < 4.5).map(([name, a, b]) => `${name} ${a} ${b} ${contrast(a, b).toFixed(2)}`);
  const button = buttonVars(t);
  const brand = button["--color-brand"] ?? "";
  const onBrand = button["--color-on-brand"] ?? "";
  if (contrast(brand, "#FFFFFF") < 3) fails.push(`brand on white ${brand}`);
  if (contrast(onBrand, brand) < 4.5) fails.push(`on-brand ${onBrand} ${brand}`);
  return fails;
}

// mulberry32: deterministic, so a failure reproduces.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("customTheme", () => {
  const random = prng(20261020);
  const hex = () => `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, "0")}`;
  const cases = Array.from({ length: 200 }, (_, i) => ({
    base: THEME_IDS[i % THEME_IDS.length] ?? "craie",
    // Every 10th case keeps one preset colour, so the accent-only and background-only paths are covered too.
    accent: i % 10 === 3 ? null : hex(),
    bg: i % 10 === 7 ? null : hex(),
  }));

  it.each(cases)("$base accent $accent bg $bg keeps every pair readable", ({ base, accent, bg }) => {
    expect(check(customTheme(base, { accent, bg }))).toEqual([]);
  });

  it.each([
    ["mid grey", "#777777", "#7A7A7A"],
    ["pure red", "#FF0000", "#E53935"],
    ["white on white", "#FFFFFF", "#FFFFFF"],
    ["black on black", "#000000", "#000000"],
    ["yellow on yellow", "#FFEB3B", "#FFE000"],
  ])("handles %s", (_, accent, bg) => {
    expect(check(customTheme("craie", { accent, bg }))).toEqual([]);
  });

  it("keeps her colours when they already read", () => {
    const t = customTheme("craie", { accent: "#8A1538", bg: "#FDF6EC" });
    expect(t.accent).toBe("#8A1538");
    expect(t.bg).toBe("#FDF6EC");
    expect(t.scheme).toBe("light");
    expect(customTheme("craie", { accent: "#F2C14E", bg: "#101820" })).toMatchObject({ bg: "#101820", accent: "#F2C14E", scheme: "dark" });
  });

  it("keeps the preset page colours when only the accent is hers", () => {
    const t = customTheme("pierre", { accent: "#1F45C4", bg: null });
    expect(t).toMatchObject({ ...THEMES.pierre, accent: "#1F45C4", onAccent: "#FFFFFF" });
  });
});

describe("vars", () => {
  it("themeVars(id) is pageVars of the preset", () => {
    for (const id of THEME_IDS) expect(themeVars(id)).toEqual(pageVars(THEMES[id]));
  });

  it("customVars is null without colours, page variables otherwise", () => {
    expect(customVars("rose", { accent: null, bg: null })).toBeNull();
    expect(customVars("rose", { accent: "nope", bg: "" })).toBeNull();
    expect(customVars("rose", { accent: "#123456", bg: null })).toEqual(pageVars(customTheme("rose", { accent: "#123456", bg: null })));
    expect(customButtonVars("rose", { accent: null, bg: null })).toBeNull();
    expect(customButtonVars("rose", { accent: "#123456", bg: null })).toEqual(buttonVars(customTheme("rose", { accent: "#123456", bg: null })));
  });

  it("normalizes hex input", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("a1b2c3")).toBe("#A1B2C3");
    expect(normalizeHex("red")).toBeNull();
  });
});
