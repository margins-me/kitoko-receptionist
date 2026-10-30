import type { Layout } from "@kitoko/themes";

// Pure parts of <ProPage>: its tabs and their URL, service groups, contact links and photo maths.
// Framework-free, so the public page, the dashboard preview, the landing configurator and tests share them.

export const TAB_IDS = ["prestations", "photos", "avis", "infos", "boutique"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** The query parameter of a deep-linked tab: kitoko.page/nala?onglet=avis. */
export const TAB_PARAM = "onglet";

/** The tabs in order: services and infos always; photos, reviews and the shop only when there are some. */
export function pageTabs(i: { photos: number; reviews: boolean; shop: boolean }): TabId[] {
  return [
    "prestations",
    ...(i.photos > 0 ? (["photos"] as const) : []),
    ...(i.reviews ? (["avis"] as const) : []),
    "infos",
    ...(i.shop ? (["boutique"] as const) : []),
  ];
}

function decode(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/** The tab a URL asks for: ?onglet=avis, else an old #avis link. Null when it names none of `tabs`. */
export function tabFromUrl(search: string, hash: string, tabs: readonly TabId[]): TabId | null {
  const wanted = new URLSearchParams(search).get(TAB_PARAM) ?? decode(hash);
  return tabs.find((t) => t === wanted) ?? null;
}

/**
 * The page URL showing `id`: ?onglet=<id>, none for the first tab. The rest of the query (booking state) is kept;
 * an old tab #hash is dropped so it cannot win over the parameter on reload.
 */
export function urlWithTab(location: { pathname: string; search: string; hash: string }, id: TabId, tabs: readonly TabId[]): string {
  const query = new URLSearchParams(location.search);
  if (id === tabs[0]) query.delete(TAB_PARAM);
  else query.set(TAB_PARAM, id);
  const qs = query.toString();
  const hash = (tabs as readonly string[]).includes(decode(location.hash)) ? "" : location.hash;
  return `${location.pathname}${qs ? `?${qs}` : ""}${hash}`;
}

/**
 * The header cuts her bio to 2 lines; a longer one also gets an Infos row, read in full there.
 * ponytail: a length guess (~2 phone lines) for "would be cut"; measure the clamp if short bios show twice.
 */
export const bioInInfos = (bio: string | null): bio is string => (bio?.trim().length ?? 0) > 90;

/** object-position for a focal point (0..1 each way): "50% 30%". Out-of-range or missing values centre. */
export function coverPosition(focalX: number, focalY: number): string {
  const pct = (v: number) => (Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10 : 50);
  return `${pct(focalX)}% ${pct(focalY)}%`;
}

/**
 * `sizes` of the cover per layout, for the app's srcset and preload. Bandeau and plein are full-bleed; encadré is
 * the inset (16 px gutters) on phones and the 2/3 photo of the 1120 px column from 860 px.
 */
export function coverSizes(layout: Layout): string {
  return layout === "encadre" ? "(min-width: 860px) min(740px, 66vw), calc(100vw - 32px)" : "100vw";
}

/** `sizes` of the other photos: the Photos grid (2 columns, 4 from 860 px) and the encadré strip. */
export const PHOTO_SIZES = {
  grid: "(min-width: 860px) 280px, 50vw",
  strip: "(min-width: 860px) min(370px, 33vw), calc(100vw - 32px)",
} as const;

/** `sizes` of her logo (sur-mesure): 48 px tall on phones, 64 px on desktop, a wide one capped by the column. */
export const LOGO_SIZES = "(min-width: 860px) 480px, 360px";

/** Header layouts drawn over a photo: their buttons sit on white 94 % pills. */
export const onPhoto = (layout: Layout): boolean => layout === "bandeau" || layout === "plein";

/** Categories in the pro's order, uncategorised services last; groups without services are dropped. */
export function serviceGroups<S extends { categoryId: string | null }>(
  categories: readonly { id: string; name: string }[],
  services: readonly S[],
  otherTitle: string,
): { id: string; title: string; services: S[] }[] {
  const known = new Set(categories.map((c) => c.id));
  return [
    ...categories.map((c) => ({ id: c.id, title: c.name, services: services.filter((s) => s.categoryId === c.id) })),
    { id: "other", title: otherTitle, services: services.filter((s) => !s.categoryId || !known.has(s.categoryId)) },
  ].filter((g) => g.services.length > 0);
}

/**
 * The services list's sections: consecutive services sharing a `group` title (one per category, in the order the
 * app sorted them), or one untitled section when none has a title.
 */
export function serviceSections<S extends { group?: string }>(services: readonly S[]): { title?: string; services: S[] }[] {
  const sections: { title?: string; services: S[] }[] = [];
  for (const service of services) {
    const last = sections.at(-1);
    if (last && last.title === service.group) last.services.push(service);
    else sections.push({ title: service.group, services: [service] });
  }
  return sections;
}

/** Rows a category shows before its "Voir les N autres prestations" button. */
export const SECTION_ROWS = 5;

/**
 * How many rows of a section wait behind the button: only in a titled section (a category; a single list is the
 * whole tab and shows whole), and only when that hides at least 2 (a button in place of a single row saves nothing).
 */
export const hiddenRows = (count: number, titled: boolean): number => (titled && count > SECTION_ROWS + 1 ? count - SECTION_ROWS : 0);

/** Whether a list draws a photo column: only when one of its services has a photo. */
export const thumbColumn = (services: readonly { image?: unknown }[]): boolean => services.some((s) => Boolean(s.image));

/** Encadré on desktop: a mosaic (1 large, 4 small) once her gallery has this many photos; fewer keep the 2/3 + 1/3 strip. */
export const MOSAIC_MIN = 5;

/** The facts under her name, ready to draw: her rating, then plain items (area) on one line; booking facts on the next. */
export type FactsLine = {
  rating: { value: string; count: string; label: string } | null;
  items: string[];
  booking: string[];
};

/**
 * `facts` when the app gives them; otherwise the older `chips` (previews), drawn as plain items on the same line.
 * Empty strings are dropped, so a missing area leaves no stray separator.
 */
export function factsLine(
  facts: { rating?: FactsLine["rating"]; area?: string | null; booking?: readonly string[] } | null | undefined,
  chips: readonly string[] | undefined,
): FactsLine {
  const filled = (list: readonly (string | null | undefined)[]) => list.filter((s): s is string => Boolean(s?.trim()));
  if (!facts) return { rating: null, items: filled(chips ?? []), booking: [] };
  return { rating: facts.rating ?? null, items: filled([facts.area]), booking: filled(facts.booking ?? []) };
}

export type ContactLink = { key: "whatsapp" | "instagram"; href: string };

/** WhatsApp and Instagram links, for the pro's details she filled in. */
export function contactLinks(pro: { whatsappE164: string | null; instagram: string | null }): ContactLink[] {
  return [
    ...(pro.whatsappE164 ? [{ key: "whatsapp" as const, href: `https://wa.me/${pro.whatsappE164.replace(/\D/g, "")}` }] : []),
    ...(pro.instagram ? [{ key: "instagram" as const, href: `https://www.instagram.com/${encodeURIComponent(pro.instagram)}/` }] : []),
  ];
}

/** Photos as absolute URLs: storage paths go through mediaUrl, full URLs stay. */
export const absolutePhoto = (path: string, mediaUrl: (path: string) => string): string =>
  /^https?:\/\//.test(path) ? path : mediaUrl(path);

/** Initials for the avatar placeholder: "Nala" → "N", "Aïcha Diallo" → "AD". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toLocaleUpperCase())
    .join("");
}
