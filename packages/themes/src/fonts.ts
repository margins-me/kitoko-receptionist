/** Title fonts: her name, section headings and the rating number. Everything else stays in Hanken Grotesk. */
export const TITLE_FONT_IDS = ["hanken", "playfair", "fraunces", "bricolage", "syne", "archivo", "cormorant"] as const;
export type TitleFontId = (typeof TITLE_FONT_IDS)[number];

export interface TitleFont {
  family: string;
  weight: number;
  tracking: string;
  /** font-stretch: the condensed cut of a variable font's width axis. */
  stretch?: string;
  /** Metric fallback while the webfont loads. */
  fallback: string;
  /** CSS variable set by each app's next/font loader (src/fonts/title-fonts.ts). */
  variable: string;
}

export const TITLE_FONTS: Record<TitleFontId, TitleFont> = {
  hanken: { family: "Hanken Grotesk", weight: 700, tracking: "-0.045em", fallback: '"Helvetica Neue", Helvetica, Arial, sans-serif', variable: "--font-hanken" },
  playfair: { family: "Playfair Display", weight: 700, tracking: "-0.02em", fallback: "Georgia, serif", variable: "--font-playfair" },
  fraunces: { family: "Fraunces", weight: 600, tracking: "-0.03em", fallback: "Georgia, serif", variable: "--font-fraunces" },
  bricolage: { family: "Bricolage Grotesque", weight: 700, tracking: "-0.04em", fallback: '"Helvetica Neue", Helvetica, Arial, sans-serif', variable: "--font-bricolage" },
  syne: { family: "Syne", weight: 700, tracking: "-0.03em", fallback: '"Helvetica Neue", Helvetica, Arial, sans-serif', variable: "--font-syne" },
  archivo: { family: "Archivo", weight: 800, tracking: "-0.01em", stretch: "68%", fallback: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', variable: "--font-archivo-title" },
  cormorant: { family: "Cormorant Garamond", weight: 600, tracking: "-0.01em", fallback: "Georgia, serif", variable: "--font-cormorant" },
};

export function isTitleFontId(value: unknown): value is TitleFontId {
  return typeof value === "string" && (TITLE_FONT_IDS as readonly string[]).includes(value);
}

/** The font-family value for a title font. */
export function titleFamily(id: TitleFontId): string {
  const font = TITLE_FONTS[id];
  return `var(${font.variable}), ${font.fallback}`;
}
