import { isTitleFontId, type TitleFontId } from "./fonts";
import { DEFAULT_STYLE, isStyleId, type StyleId } from "./styles";
import { DEFAULT_THEME, THEMES, isThemeId, type ThemeId } from "./themes";

export const LAYOUTS = ["bandeau", "plein", "encadre", "sans"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface CoverPhoto {
  /** Storage path of the original upload in pro-media. */
  path: string;
  /** 0..1, used as object-position on every crop. */
  focalX: number;
  focalY: number;
  width: number | null;
  height: number | null;
}

/** What a pro chose. Null layout or font means "not chosen": the suggestion or the theme's font applies. */
export interface PageAppearance {
  layout: Layout | null;
  style: StyleId;
  theme: ThemeId;
  titleFont: TitleFontId | null;
  cover: CoverPhoto | null;
  gallery: string[];
}

/** What the page renders. */
export interface ResolvedAppearance {
  layout: Layout;
  style: StyleId;
  theme: ThemeId;
  titleFont: TitleFontId;
}

export function isLayout(value: unknown): value is Layout {
  return typeof value === "string" && (LAYOUTS as readonly string[]).includes(value);
}

const unit = (value: unknown) => (typeof value === "number" && value >= 0 && value <= 1 ? value : 0.5);
const size = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

/** Untrusted values (DB row, form, URL) to a valid appearance; anything unknown falls back to the defaults. */
export function parseAppearance(raw: {
  layout?: unknown;
  style?: unknown;
  theme?: unknown;
  titleFont?: unknown;
  coverPath?: unknown;
  focalX?: unknown;
  focalY?: unknown;
  coverWidth?: unknown;
  coverHeight?: unknown;
  gallery?: unknown;
}): PageAppearance {
  const path = typeof raw.coverPath === "string" && raw.coverPath ? raw.coverPath : null;
  return {
    layout: isLayout(raw.layout) ? raw.layout : null,
    style: isStyleId(raw.style) ? raw.style : DEFAULT_STYLE,
    theme: isThemeId(raw.theme) ? raw.theme : DEFAULT_THEME,
    titleFont: isTitleFontId(raw.titleFont) ? raw.titleFont : null,
    cover: path ? { path, focalX: unit(raw.focalX), focalY: unit(raw.focalY), width: size(raw.coverWidth), height: size(raw.coverHeight) } : null,
    gallery: Array.isArray(raw.gallery) ? raw.gallery.filter((p): p is string => typeof p === "string" && p !== "") : [],
  };
}

/**
 * Layout suggested from her photos (onboarding, first cover). Never overrides a layout she chose. No cover: the
 * bandeau in her accent colour, so "sans" only when she picks it.
 * ponytail: aspect ratio only, no "strong contrast" check; add a luminance test if suggestions look wrong.
 */
export function suggestLayout({ cover, galleryCount }: { cover: Pick<CoverPhoto, "width" | "height"> | null; galleryCount: number }): Layout {
  if (galleryCount >= 3) return "encadre";
  if (cover?.width && cover.height && cover.height >= cover.width) return "plein";
  return "bandeau";
}

/**
 * The layout, style, theme and font the page renders. Bandeau and plein without a cover draw her accent colour;
 * encadré without any photo renders as "sans".
 */
export function resolveAppearance(appearance: PageAppearance): ResolvedAppearance {
  const { cover, gallery, style, theme } = appearance;
  const chosen = appearance.layout ?? suggestLayout({ cover, galleryCount: gallery.length });
  return {
    layout: chosen === "encadre" && !cover && gallery.length === 0 ? "sans" : chosen,
    style,
    theme,
    titleFont: appearance.titleFont ?? THEMES[theme].font,
  };
}

export const DEFAULT_APPEARANCE: PageAppearance = { layout: null, style: DEFAULT_STYLE, theme: DEFAULT_THEME, titleFont: null, cover: null, gallery: [] };
