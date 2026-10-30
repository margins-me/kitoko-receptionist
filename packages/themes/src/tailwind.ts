import plugin from "tailwindcss/plugin";
import { TITLE_FONT_IDS, TITLE_FONTS, titleFamily, type TitleFontId } from "./fonts";
import { STYLE_IDS, STYLES, type StyleId } from "./styles";
import { THEME_IDS, brandVars, themeVars } from "./themes";

// Re-exported for existing imports from "@kitoko/themes/tailwind"; they live in themes.ts so the package index exports them.
export { brandVars, themeVars };

export function fontVars(id: TitleFontId): Record<string, string> {
  const f = TITLE_FONTS[id];
  return { "--title-family": titleFamily(id), "--title-weight": String(f.weight), "--title-tracking": f.tracking, "--title-stretch": f.stretch ?? "100%" };
}

export function styleVars(id: StyleId): Record<string, string> {
  return { ...STYLES[id].vars };
}

export default plugin(({ addBase }) => {
  addBase(Object.fromEntries(THEME_IDS.map((id) => [`[data-theme="${id}"]`, themeVars(id)])));
  addBase(Object.fromEntries(THEME_IDS.map((id) => [`[data-brand="${id}"]`, brandVars(id)])));
  addBase(Object.fromEntries(TITLE_FONT_IDS.map((id) => [`[data-font="${id}"]`, fontVars(id)])));
  addBase(Object.fromEntries(STYLE_IDS.map((id) => [`[data-style="${id}"]`, styleVars(id)])));
});
