import { Archivo, Bricolage_Grotesque, Cormorant_Garamond, Fraunces, Playfair_Display, Syne } from "next/font/google";
import type { TitleFontId } from "@kitoko/themes";

// The pro page's title fonts (packages/themes TITLE_FONTS): her name, section headings and the rating number.
// Each sets the CSS variable [data-font] reads. Not preloaded, and the page applies only her font's class, so a
// visit downloads Hanken (src/fonts/hanken.ts) plus that one font.

// next/font needs literal options in each call.
const playfair = Playfair_Display({ weight: "700", subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-playfair" });
const fraunces = Fraunces({ axes: ["opsz"], subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-fraunces" });
const bricolage = Bricolage_Grotesque({ axes: ["opsz"], subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-bricolage" });
const syne = Syne({ weight: "700", subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-syne" });
// Its own instance (not src/fonts/archivo.ts, the logo's): not preloaded, condensed through the width axis.
const archivo = Archivo({ axes: ["wdth"], subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-archivo-title" });
const cormorant = Cormorant_Garamond({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-cormorant" });

/** Class defining a title font's variable. Hanken's is already on <html> (root layout). */
export const TITLE_FONT_CLASS: Record<TitleFontId, string> = {
  hanken: "",
  playfair: playfair.variable,
  fraunces: fraunces.variable,
  bricolage: bricolage.variable,
  syne: syne.variable,
  archivo: archivo.variable,
  cormorant: cormorant.variable,
};
