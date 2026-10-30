import type { TitleFontId } from "./fonts";

/** Pro page colour themes. Contrast-checked in test/themes.test.ts; markup never names one (see tailwind.ts). */
export const THEME_IDS = [
  "craie", "pierre", "taupe", "terre", "rose", "lilas", "prune", "cannelle", "sauge", "cobalt", "indigo", "velours", "bogolan", "ebene",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface Theme {
  bg: string;
  chip: string;
  fg: string;
  muted: string;
  line: string;
  /** Also the title colour. */
  accent: string;
  onAccent: string;
  /** Applied with the theme the first time she picks it, unless she chose a font herself. */
  font: TitleFontId;
  scheme: "light" | "dark";
  /** Hidden from pickers, still rendered for pros who use it. */
  retired?: true;
}

export const THEMES: Record<ThemeId, Theme> = {
  craie: { bg: "#FFFFFF", chip: "#F5F4F2", fg: "#161616", muted: "#66625E", line: "#E6E3DF", accent: "#161616", onAccent: "#FFFFFF", font: "hanken", scheme: "light" },
  pierre: { bg: "#F2EEE8", chip: "#FFFFFF", fg: "#161616", muted: "#5F5A55", line: "#E2DCD4", accent: "#7A4A17", onAccent: "#FFFFFF", font: "fraunces", scheme: "light" },
  taupe: { bg: "#D3CDC5", chip: "#E2DDD6", fg: "#1E1B18", muted: "#47423D", line: "#BDB6AD", accent: "#1E1B18", onAccent: "#F4F1ED", font: "playfair", scheme: "light" },
  terre: { bg: "#F6ECE1", chip: "#FFFFFF", fg: "#2A1810", muted: "#6B5243", line: "#E8D7C4", accent: "#9E3F1C", onAccent: "#FFFFFF", font: "fraunces", scheme: "light" },
  rose: { bg: "#F9EBEE", chip: "#FFFFFF", fg: "#2A1A1F", muted: "#6B5359", line: "#EDD5DB", accent: "#A23B5C", onAccent: "#FFFFFF", font: "fraunces", scheme: "light" },
  lilas: { bg: "#F4EFFA", chip: "#FFFFFF", fg: "#1E1726", muted: "#625A6E", line: "#E4DBEF", accent: "#6A3D9E", onAccent: "#FFFFFF", font: "fraunces", scheme: "light" },
  prune: { bg: "#FFFFFF", chip: "#F6EFF2", fg: "#1F1418", muted: "#66585E", line: "#EADFE4", accent: "#6E2A4A", onAccent: "#FFFFFF", font: "playfair", scheme: "light" },
  cannelle: { bg: "#FBF2E9", chip: "#FFFFFF", fg: "#2B1D14", muted: "#6A5848", line: "#EEDFCF", accent: "#9A4A1E", onAccent: "#FFFFFF", font: "bricolage", scheme: "light" },
  sauge: { bg: "#EEF1EB", chip: "#FFFFFF", fg: "#18201C", muted: "#56605A", line: "#DCE2DA", accent: "#2F5D4E", onAccent: "#FFFFFF", font: "bricolage", scheme: "light" },
  cobalt: { bg: "#FFFFFF", chip: "#F1F4FB", fg: "#121624", muted: "#5C6170", line: "#E2E6EF", accent: "#1F45C4", onAccent: "#FFFFFF", font: "syne", scheme: "light" },
  indigo: { bg: "#1A2040", chip: "#252C52", fg: "#F4EFE6", muted: "#BDBBCD", line: "#333B63", accent: "#E3AE4A", onAccent: "#1A2040", font: "fraunces", scheme: "dark" },
  velours: { bg: "#2A1420", chip: "#3A2130", fg: "#F7EEF2", muted: "#CDB6C0", line: "#47293A", accent: "#E8B4C8", onAccent: "#2A1420", font: "playfair", scheme: "dark" },
  bogolan: { bg: "#2A1D14", chip: "#3A2A1E", fg: "#F4EBDD", muted: "#CDBBA5", line: "#4A3627", accent: "#EAD9B6", onAccent: "#2A1D14", font: "fraunces", scheme: "dark" },
  ebene: { bg: "#0E0E0E", chip: "#1C1B1A", fg: "#F5F2EC", muted: "#B5AFA6", line: "#2C2A27", accent: "#C9A45C", onAccent: "#0E0E0E", font: "playfair", scheme: "dark" },
};

export const DEFAULT_THEME: ThemeId = "craie";

/** Themes offered in pickers (retired ones stay renderable). */
export const PICKER_THEMES = THEME_IDS.filter((id) => !THEMES[id].retired);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

const INK = "#161616";
const WHITE = "#FFFFFF";

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The theme's button colour on Kitoko's white surfaces (booking sheets, checkout, emails).
 * A pale accent (Velours, Ébène) would vanish on white, so those fall back to ink.
 */
export function safeAccent(theme: ThemeId | Theme): { accent: string; onAccent: string } {
  const { accent, onAccent } = typeof theme === "string" ? THEMES[theme] : theme;
  return contrast(accent, WHITE) >= 3 ? { accent, onAccent } : { accent: INK, onAccent: WHITE };
}

/**
 * The role tokens a theme overrides. Components only use role utilities (bg-page, text-page-muted,
 * bg-accent text-on-accent…); a preset is chosen by `data-theme` on the page root (tailwind.ts), her
 * sur-mesure colours come as these same variables in an inline style (customVars). White surfaces of that
 * pro (sheets, checkout) use buttonVars instead, so they keep a light colour-scheme.
 */
export function pageVars(t: Theme): Record<string, string> {
  const onWhite = safeAccent(t);
  return {
    "--color-page": t.bg,
    "--color-page-chip": t.chip,
    "--color-page-fg": t.fg,
    "--color-page-muted": t.muted,
    "--color-page-line": t.line,
    "--color-accent": t.accent,
    "--color-on-accent": t.onAccent,
    // Buttons on Kitoko's white surfaces (sheets, checkout) inside a themed page.
    "--color-brand": onWhite.accent,
    "--color-on-brand": onWhite.onAccent,
    "--color-focus": t.fg,
    "color-scheme": t.scheme,
  };
}

/** Only the button colours, for Kitoko's white surfaces of a themed pro (portaled sheets, checkout, manage pages). */
export function buttonVars(t: Theme): Record<string, string> {
  const { accent, onAccent } = safeAccent(t);
  return { "--color-brand": accent, "--color-on-brand": onAccent };
}

export const themeVars = (id: ThemeId): Record<string, string> => pageVars(THEMES[id]);
export const brandVars = (id: ThemeId): Record<string, string> => buttonVars(THEMES[id]);
