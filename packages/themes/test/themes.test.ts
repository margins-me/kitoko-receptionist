import { describe, expect, it } from "vitest";
import plugin, { brandVars, fontVars, styleVars, themeVars } from "../src/tailwind";
import { STYLE_IDS, STYLES, THEME_IDS, THEMES, TITLE_FONT_IDS, contrast, safeAccent } from "../src";

// Handover §3: every theme must keep text readable (WCAG 1.4.3, 4.5:1).
describe.each(THEME_IDS)("theme %s", (id) => {
  const t = THEMES[id];
  it.each([
    ["fg on bg", t.fg, t.bg],
    ["muted on bg", t.muted, t.bg],
    ["muted on chip", t.muted, t.chip],
    ["title (accent) on bg", t.accent, t.bg],
    ["button text on accent", t.onAccent, t.accent],
    ["fg on chip", t.fg, t.chip],
  ])("%s ≥ 4.5:1", (_, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a visible, readable button on white surfaces", () => {
    const { accent, onAccent } = safeAccent(id);
    expect(contrast(accent, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrast(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
  });
});

it("keeps the fixed pills on photos readable (#161616 on white)", () => {
  expect(contrast("#161616", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
});

describe("tailwind plugin", () => {
  const base: Record<string, Record<string, string>> = {};
  plugin.handler({ addBase: (rules: Record<string, Record<string, string>>) => Object.assign(base, rules) } as never);

  it("emits one page rule and one brand rule per theme, one rule per font and one per style", () => {
    for (const id of THEME_IDS) expect(base[`[data-theme="${id}"]`]).toEqual(themeVars(id));
    for (const id of THEME_IDS) expect(base[`[data-brand="${id}"]`]).toEqual(brandVars(id));
    for (const id of TITLE_FONT_IDS) expect(base[`[data-font="${id}"]`]).toEqual(fontVars(id));
    for (const id of STYLE_IDS) expect(base[`[data-style="${id}"]`]).toEqual(styleVars(id));
    expect(Object.keys(base)).toHaveLength(2 * THEME_IDS.length + TITLE_FONT_IDS.length + STYLE_IDS.length);
  });

  it("falls back to ink buttons on white for pale accents", () => {
    expect(themeVars("velours")["--color-brand"]).toBe("#161616");
    expect(themeVars("rose")["--color-brand"]).toBe(THEMES.rose.accent);
  });
});

describe("styles", () => {
  it("set every token, so switching style never keeps the previous one's value", () => {
    const keys = Object.keys(STYLES.epure.vars);
    for (const id of STYLE_IDS) expect(Object.keys(STYLES[id].vars)).toEqual(expect.arrayContaining(keys));
  });

  it("suggest a theme and a font that exist", () => {
    for (const id of STYLE_IDS) {
      expect(THEME_IDS).toContain(STYLES[id].preset.theme);
      expect(TITLE_FONT_IDS).toContain(STYLES[id].preset.font);
    }
  });
});
