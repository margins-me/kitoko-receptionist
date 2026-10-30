import type { Layout } from "./appearance";
import type { TitleFontId } from "./fonts";
import type { ThemeId } from "./themes";

/**
 * Pro page styles: the shapes of the page (corners, rules, tabs, service rows, title case, decoration), where themes
 * are its colours. Set by `data-style` on the page root (see tailwind.ts); markup only uses the tokens below.
 */
export const STYLE_IDS = ["epure", "editorial", "doux", "street", "heritage", "prestige", "spa"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

/** The CSS custom properties a style sets. The --radius-pp-* defaults (Épuré) are in packages/ui/src/styles.css. */
export interface StyleVars {
  "--radius-pp-button": string;
  "--radius-pp-chip": string;
  "--radius-pp-avatar": string;
  /** Large surfaces: the encadré strip, the desktop "Prochains créneaux" card, review cards. */
  "--radius-pp-card": string;
  "--radius-pp-photo": string;
  "--radius-pp-photo-desk": string;
  /** Width and colour of the page's rules (tab bar, info rows, booking bar, outlined buttons). */
  "--pp-rule": string;
  "--pp-rule-color": string;
  /** Service rows: a hairline list or cards. `border` is a border-width shorthand. */
  "--pp-row-border": string;
  "--pp-row-bg": string;
  "--pp-row-radius": string;
  "--pp-row-pad": string;
  "--pp-row-gap": string;
  /** display of the "01" number before each service: none or block. */
  "--pp-row-number": string;
  "--pp-tab-pad": string;
  "--pp-tab-radius": string;
  /** Vertical margin of a tab inside the bar: 0 for an underline, more for a filled pill or block. */
  "--pp-tab-inset": string;
  "--pp-tab-active-bg": string;
  "--pp-tab-active-fg": string;
  "--pp-tab-indicator": string;
  "--pp-tab-case": string;
  "--pp-tab-tracking": string;
  /** A band under the header: a mask image drawn in the accent, and its height (0 = none). */
  "--pp-decor": string;
  "--pp-decor-h": string;
  /** Unset: the title font's own weight and tracking apply. */
  "--pp-title-weight"?: string;
  "--pp-title-tracking"?: string;
  "--pp-title-case"?: string;
}

export interface PageStyle {
  /** Applied with the style in pickers: she can change each one afterwards. The layout only on samples. */
  preset: { theme: ThemeId; font: TitleFontId; layout: Layout };
  vars: StyleVars;
}

/** A repeating mask tile. */
const tile = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

const EPURE: StyleVars = {
  "--radius-pp-button": "9999px",
  "--radius-pp-chip": "9999px",
  "--radius-pp-avatar": "9999px",
  "--radius-pp-card": "32px",
  "--radius-pp-photo": "18px",
  "--radius-pp-photo-desk": "24px",
  "--pp-rule": "1px",
  "--pp-rule-color": "var(--color-page-line)",
  "--pp-row-border": "0 0 1px",
  "--pp-row-bg": "transparent",
  "--pp-row-radius": "0px",
  "--pp-row-pad": "0px",
  "--pp-row-gap": "0px",
  "--pp-row-number": "none",
  "--pp-tab-pad": "4px",
  "--pp-tab-radius": "0px",
  "--pp-tab-inset": "0px",
  "--pp-tab-active-bg": "transparent",
  "--pp-tab-active-fg": "var(--color-page-fg)",
  "--pp-tab-indicator": "2px",
  "--pp-tab-case": "none",
  "--pp-tab-tracking": "normal",
  "--pp-decor": "none",
  "--pp-decor-h": "0px",
};

const SQUARE = {
  "--radius-pp-button": "0px",
  "--radius-pp-chip": "0px",
  "--radius-pp-avatar": "0px",
  "--radius-pp-card": "0px",
  "--radius-pp-photo": "0px",
  "--radius-pp-photo-desk": "0px",
} satisfies Partial<StyleVars>;

export const STYLES: Record<StyleId, PageStyle> = {
  // Today's page: pills, hairlines, underlined tabs.
  epure: { preset: { theme: "craie", font: "hanken", layout: "bandeau" }, vars: EPURE },
  // Magazine: square corners, small-caps tabs, numbered services, a lighter title, a double rule.
  editorial: {
    preset: { theme: "ebene", font: "fraunces", layout: "plein" },
    vars: {
      ...EPURE,
      ...SQUARE,
      "--radius-pp-button": "2px",
      "--radius-pp-chip": "2px",
      "--pp-row-number": "block",
      "--pp-tab-indicator": "1px",
      "--pp-tab-case": "uppercase",
      "--pp-tab-tracking": "0.12em",
      "--pp-decor": tile(4, 5, "<rect width='4' height='1'/><rect y='4' width='4' height='1'/>"),
      "--pp-decor-h": "5px",
      "--pp-title-weight": "400",
      "--pp-title-tracking": "-0.02em",
    },
  },
  // Soft: service cards, filled pill tabs, arched photos.
  doux: {
    preset: { theme: "rose", font: "fraunces", layout: "encadre" },
    vars: {
      ...EPURE,
      "--radius-pp-card": "36px",
      "--radius-pp-photo": "9999px 9999px 20px 20px",
      "--radius-pp-photo-desk": "9999px 9999px 24px 24px",
      "--pp-row-border": "0px",
      "--pp-row-bg": "var(--color-page-chip)",
      "--pp-row-radius": "20px",
      "--pp-row-pad": "16px",
      "--pp-row-gap": "8px",
      "--pp-tab-pad": "14px",
      "--pp-tab-radius": "9999px",
      "--pp-tab-inset": "8px",
      "--pp-tab-active-bg": "var(--color-accent)",
      "--pp-tab-active-fg": "var(--color-on-accent)",
      "--pp-tab-indicator": "0px",
    },
  },
  // Barber: square, 2 px ink rules, bordered blocks, block tabs, condensed uppercase titles.
  street: {
    preset: { theme: "ebene", font: "archivo", layout: "plein" },
    vars: {
      ...EPURE,
      ...SQUARE,
      "--pp-rule": "2px",
      "--pp-rule-color": "var(--color-page-fg)",
      "--pp-row-border": "2px",
      "--pp-row-pad": "14px",
      "--pp-row-gap": "8px",
      "--pp-tab-pad": "12px",
      "--pp-tab-inset": "8px",
      "--pp-tab-active-bg": "var(--color-page-fg)",
      "--pp-tab-active-fg": "var(--color-page)",
      "--pp-tab-indicator": "0px",
      "--pp-tab-case": "uppercase",
      "--pp-tab-tracking": "0.04em",
      "--pp-title-case": "uppercase",
    },
  },
  // Rooted: softer corners and a band of alternating triangles (our own motif, wax/bogolan-inspired) in the accent.
  heritage: {
    preset: { theme: "terre", font: "fraunces", layout: "bandeau" },
    vars: {
      ...EPURE,
      "--radius-pp-card": "16px",
      "--radius-pp-photo": "14px",
      "--radius-pp-photo-desk": "18px",
      "--pp-tab-indicator": "3px",
      "--pp-decor": tile(24, 12, "<path d='M0 12 6 1l6 11z'/><path d='M12 0h12l-6 11z'/>"),
      "--pp-decor-h": "12px",
    },
  },
  // Luxury: thin gold rules, uppercase tracked titles and tabs, a hairline with small diamonds.
  prestige: {
    preset: { theme: "ebene", font: "cormorant", layout: "plein" },
    vars: {
      ...EPURE,
      "--radius-pp-button": "3px",
      "--radius-pp-chip": "3px",
      "--radius-pp-card": "6px",
      "--radius-pp-photo": "4px",
      "--radius-pp-photo-desk": "6px",
      "--pp-rule-color": "color-mix(in srgb, var(--color-accent) 40%, transparent)",
      "--pp-tab-indicator": "1px",
      "--pp-tab-case": "uppercase",
      "--pp-tab-tracking": "0.16em",
      "--pp-decor": tile(56, 7, "<rect y='3' width='56' height='1'/><path d='M28 0l3.5 3.5L28 7l-3.5-3.5z'/>"),
      "--pp-decor-h": "7px",
      "--pp-title-weight": "500",
      "--pp-title-tracking": "0.08em",
      "--pp-title-case": "uppercase",
    },
  },
  // Calm: soft rounded photos, outlined service cards, tinted pill tabs, a gentle wave.
  spa: {
    preset: { theme: "sauge", font: "cormorant", layout: "bandeau" },
    vars: {
      ...EPURE,
      "--radius-pp-card": "40px",
      "--radius-pp-photo": "28px",
      "--radius-pp-photo-desk": "32px",
      "--pp-row-border": "1px",
      "--pp-row-bg": "transparent",
      "--pp-row-radius": "24px",
      "--pp-row-pad": "18px",
      "--pp-row-gap": "10px",
      "--pp-tab-pad": "14px",
      "--pp-tab-radius": "9999px",
      "--pp-tab-inset": "8px",
      "--pp-tab-active-bg": "color-mix(in srgb, var(--color-accent) 14%, transparent)",
      "--pp-tab-active-fg": "var(--color-page-fg)",
      "--pp-tab-indicator": "0px",
      "--pp-decor": tile(40, 8, "<path d='M0 4Q10 0 20 4T40 4' fill='none' stroke='#000' stroke-width='1.5'/>"),
      "--pp-decor-h": "8px",
      "--pp-title-weight": "500",
    },
  },
};

export const DEFAULT_STYLE: StyleId = "epure";

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && (STYLE_IDS as readonly string[]).includes(value);
}
