import { DEFAULT_STYLE } from "./styles";
import type { StyleId } from "./styles";
import { PICKER_THEMES, THEMES } from "./themes";
import type { Theme, ThemeId } from "./themes";

// "On l'a choisi pour toi": the theme and style the setup starts her on, from her brand colour (an imported page) and
// her trades. The rules of the demo-page skill's look section (.claude/skills/kitoko-demo-page, section 4). Pure.

type Hsl = { h: number; s: number; l: number; chroma: number };

/** "#rrggbb" or "#rgb" as hue (degrees), saturation, lightness and chroma (0..1); null when not a colour. */
function hsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const l = (max + min) / 2;
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (chroma > 0) {
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l, chroma };
}

/** Grey, white or black (saturation under 15 %, or next to no chroma): its hue says nothing. */
const isNeutral = (c: Hsl) => c.s < 0.15 || c.chroma < 0.03;

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Within this hue gap two colours count as a match. */
const HUE_MATCH = 25;
/** At or under this lightness her colour is a dark background; at or over the other, a pale one. */
const DARK = 0.25;
const PALE = 0.75;

type Point = { id: ThemeId; colour: Hsl };

/** One colour role (bg or accent) of the picker's themes of a scheme, the neutral ones left out (they match no hue). */
const points = (scheme: Theme["scheme"], role: "bg" | "accent"): Point[] =>
  PICKER_THEMES.filter((id) => THEMES[id].scheme === scheme)
    .map((id) => ({ id, colour: hsl(THEMES[id][role]) }))
    .filter((p): p is Point => p.colour !== null && !isNeutral(p.colour));

const DARK_BACKGROUNDS = points("dark", "bg");
const LIGHT_BACKGROUNDS = points("light", "bg");
const LIGHT_ACCENTS = points("light", "accent");
/** A grey, white or black brand is matched by lightness only, against these backgrounds. */
const NEUTRAL_THEMES: ThemeId[] = (["craie", "taupe", "ebene"] as const).filter((id) => PICKER_THEMES.includes(id));

/** The nearest hue within 25°, then the nearest lightness; null when none is that close. */
function nearest(c: Hsl, among: readonly Point[]): ThemeId | null {
  let best: { id: ThemeId; gap: number; dl: number } | null = null;
  for (const { id, colour } of among) {
    const gap = hueGap(c.h, colour.h);
    const dl = Math.abs(c.l - colour.l);
    if (gap <= HUE_MATCH && (!best || gap < best.gap || (gap === best.gap && dl < best.dl))) best = { id, gap, dl };
  }
  return best?.id ?? null;
}

/**
 * The picker theme closest to her brand colour, or null (no colour, or none close: the setup keeps its default).
 * A dark colour is her background: a dark theme of that hue first (navy → indigo, wine → velours, chocolate →
 * bogolan). A pale one is too: a light theme whose background has her hue (blush → rose, cream → pierre). Any other,
 * or when those found nothing: the light theme whose accent is nearest in hue. Grey, white and black by lightness only.
 */
export function suggestTheme(hex: string | null): ThemeId | null {
  const c = hex === null ? null : hsl(hex);
  if (!c) return null;
  if (isNeutral(c)) {
    const byLightness = NEUTRAL_THEMES.map((id) => ({ id, dl: Math.abs(c.l - (hsl(THEMES[id].bg)?.l ?? 0)) })).sort((a, b) => a.dl - b.dl);
    return byLightness[0]?.id ?? null;
  }
  if (c.l <= DARK) return nearest(c, DARK_BACKGROUNDS) ?? nearest(c, LIGHT_ACCENTS);
  if (c.l >= PALE) return nearest(c, LIGHT_BACKGROUNDS) ?? nearest(c, LIGHT_ACCENTS);
  return nearest(c, LIGHT_ACCENTS);
}

/**
 * The style each trade starts on (@kitoko/booking's trade ids; this package does not depend on it). The first four are
 * the landing page's showcase.
 */
const TRADE_STYLES: Record<string, StyleId> = {
  tresses: "heritage",
  locks: "street",
  ongles: "doux",
  cils: "editorial",
  // Wigs are sold as luxury (installs, units, "hair boutique", black and gold): Prestige's fine rules and capitals.
  perruques: "prestige",
  // Soins et coupe is the broadest trade (cuts, blow-dries, care) with no one look: Épuré, "for every trade". Listed
  // so that a hairdresser who also does lashes stays on it rather than taking her second trade's style.
  coiffure: "epure",
  // Facials and waxing are skin care: Spa's calm outlined cards and soft wave.
  visage: "spa",
  // Massage & bien-être is the trade Spa is drawn for.
  massage: "spa",
  // Make-up and brows sell on portfolio shots (bridal, shoots): Éditorial's magazine frame, square photos, numbered looks.
  maquillage: "editorial",
};

/** The style of her first trade that has one; Épuré otherwise. */
export function suggestStyle(trades: readonly string[]): StyleId {
  for (const trade of trades) {
    const style = TRADE_STYLES[trade];
    if (style) return style;
  }
  return DEFAULT_STYLE;
}
