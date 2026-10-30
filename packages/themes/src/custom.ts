import { buttonVars, contrast, pageVars, THEMES, type Theme, type ThemeId } from "./themes";

/** Her sur-mesure colours (Pro plan): #RRGGBB or null to keep the preset's. */
export type CustomColours = { accent: string | null; bg: string | null };

const INK = "#161616";
const PAPER = "#F5F2EC";
const WHITE = "#FFFFFF";
const BLACK = "#000000";

// Margins over the 4.5:1 floor. Text on the page must clear it with room for muted: fg aims for 6:1.
const TEXT = 4.5;
const FG_MIN = 6;
const STEP = 0.02;

/** "#abc", "abc", "#AABBCC" → "#AABBCC"; anything else → null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const v = value?.trim().replace(/^#/, "") ?? "";
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${[...v].map((c) => c + c).join("").toUpperCase()}`;
  return null;
}

/** sRGB mix: t = 0 gives `a`, t = 1 gives `b`. */
function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** Moves `from` toward `to` by the smallest STEP multiple that satisfies `ok` (`to` itself must satisfy it). */
function nudge(from: string, to: string, ok: (c: string) => boolean): string {
  for (let t = 0; t < 1; t += STEP) {
    const c = mix(from, to, t);
    if (ok(c)) return c;
  }
  return to;
}

/**
 * A preset with her own background and/or accent. The background sets the scheme and the text colours (ink or
 * paper, muted mixed toward the background); a mid-tone background is nudged lighter or darker until ink or paper
 * reads on it at 6:1. The accent (also the title colour) is darkened on a light page, lightened on a dark one,
 * until it reads at 4.5:1 and white or ink reads on it. Every pair of test/themes.test.ts holds for any input.
 */
export function customTheme(base: ThemeId, colours: CustomColours): Theme {
  const preset = THEMES[base];
  const bgIn = normalizeHex(colours.bg);
  const accentIn = normalizeHex(colours.accent) ?? preset.accent;

  let page: Pick<Theme, "bg" | "chip" | "fg" | "muted" | "line" | "scheme">;
  if (!bgIn) {
    page = preset;
  } else {
    const light = contrast(INK, bgIn) >= contrast(PAPER, bgIn);
    const fg = light ? INK : PAPER;
    const bg = nudge(bgIn, light ? WHITE : BLACK, (c) => contrast(fg, c) >= FG_MIN);
    // Light pages get a whiter chip (as Pierre, Terre…), a near-white one a faint grey; dark pages a lighter chip.
    const chip = light ? (contrast(bg, WHITE) > 1.15 ? mix(bg, WHITE, 0.6) : mix(bg, fg, 0.04)) : mix(bg, WHITE, 0.08);
    const muted = nudge(mix(fg, bg, 0.5), fg, (c) => contrast(c, bg) >= TEXT && contrast(c, chip) >= TEXT);
    page = { bg, chip, fg, muted, line: mix(bg, fg, 0.12), scheme: light ? "light" : "dark" };
  }

  const light = page.scheme === "light";
  const onAccentFor = (a: string) => (contrast(WHITE, a) >= contrast(INK, a) ? WHITE : INK);
  const accent = nudge(accentIn, light ? BLACK : WHITE, (a) => contrast(a, page.bg) >= TEXT && contrast(onAccentFor(a), a) >= TEXT);

  return { bg: page.bg, chip: page.chip, fg: page.fg, muted: page.muted, line: page.line, scheme: page.scheme, accent, onAccent: onAccentFor(accent), font: preset.font };
}

/** Inline CSS variables for her sur-mesure colours over the preset `base`, or null when she has none. */
export function customVars(base: ThemeId, colours: CustomColours): Record<string, string> | null {
  if (!normalizeHex(colours.accent) && !normalizeHex(colours.bg)) return null;
  return pageVars(customTheme(base, colours));
}

/** Her sur-mesure button colours on Kitoko's white surfaces (<Brand vars>), or null when she has no colours. */
export function customButtonVars(base: ThemeId, colours: CustomColours): Record<string, string> | null {
  if (!normalizeHex(colours.accent) && !normalizeHex(colours.bg)) return null;
  return buttonVars(customTheme(base, colours));
}
