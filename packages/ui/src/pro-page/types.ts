import type { ReactNode } from "react";
import type { ResolvedAppearance } from "@kitoko/themes";
import type { TabId } from "./model";

/**
 * A photo as the app prepares it: a plain URL, or next/image's getImageProps output (src + srcSet with width
 * descriptors). <ProPage> sets `sizes`, loading and classes itself, per place the photo is shown.
 */
export type PageImage = { src: string; srcSet?: string; alt: string; width?: number; height?: number };

export type PageCover = {
  image: PageImage;
  /** Focal point, 0..1 each way: object-position on every crop. */
  focalX: number;
  focalY: number;
};

export type PageService = {
  id: string;
  name: string;
  /** "dès 85 €" */
  price: string;
  /** "4 h à 8 h 30" */
  duration: string;
  /** Shown under the name on desktop. */
  description?: string | null;
  /** Category title when the pro has several: a heading where the category starts. */
  group?: string;
  /** Opens the booking flow: rendered as <a data-booking>. None (previews): a plain row. */
  href?: string;
  /** Her first photo of it: a square at the start of the row (1x/2x srcset for 56 px). */
  image?: PageImage | null;
};

export type PageReview = {
  id: string;
  author: string;
  /** "12 octobre 2026" */
  when: string;
  /** ISO date for <time>. */
  dateTime?: string;
  body: string | null;
  /** 1..5 */
  rating: number;
  /** "4 sur 5", the stars' accessible name. */
  ratingLabel: string;
};

/** An Infos row: "Adresse", "Horaires", "Acompte et annulation", "Retard / À prévoir", "Contact"… */
export type PageInfo = { id: string; label: string; value: ReactNode };

export type PageContact = { key: "whatsapp" | "instagram"; href: string; label: string };

export type ProPageLabels = {
  tabs: Record<TabId, string>;
  /** Accessible name of the tab list: "Sections de la page". */
  tabList: string;
  /** The photo viewer's close button: "Fermer". */
  close: string;
  /** Share button: "Partager la page", and "Lien copié" when it went to the clipboard. */
  share: string;
  copied: string;
  /** "Nala n’a pas encore mis de prestation en ligne." */
  servicesEmpty: string;
  /** Encadré photo strip: "Photos de Nala". */
  photos: string;
  /** Mobile bar: "Prochain créneau". */
  nextSlot: string;
  /** Desktop card: "Prochains créneaux". */
  nextSlots: string;
  /**
   * A category longer than 6 rows shows 5 and a button: "Voir les # autres prestations" (# is the count, 2 or more),
   * "Voir moins" once open. Without both, every row shows.
   */
  moreServices?: string;
  fewerServices?: string;
  /** Encadré desktop mosaic, over its last tile: "Voir les # photos" (# is the count). Without it, a plain tile. */
  allPhotos?: string;
};

/** The facts line under her name. Each part only when her data says so: the app decides, the page only draws. */
export type PageFacts = {
  /** Only when she has reviews: "4,9" drawn after a star, then "(128 avis)"; read as `label`, "4,9 sur 5, 128 avis". */
  rating?: { value: string; count: string; label: string } | null;
  /** Her city or area: "Paris 18e". */
  area?: string | null;
  /** True statements about booking with her, on their own line: "Réservation 24h/24", "Confirmation immédiate". */
  booking?: string[];
};

/**
 * Everything <ProPage> renders, display-ready: no data fetching, no translations, no framework. The public page
 * builds it from the database and its messages; the dashboard preview from her real data with no islands (static
 * placeholders render instead); the landing configurator from sample data.
 */
export type ProPageProps = {
  /** resolveAppearance() of her choice. Encadré without any photo renders as "sans". */
  appearance: ResolvedAppearance;
  /**
   * Her sur-mesure colours (Pro plan): customVars() of @kitoko/themes, set inline on the page root so they win over
   * the preset's [data-theme] rule. Null or absent: the preset.
   */
  customVars?: Record<string, string> | null;
  /** Class that defines the chosen title font's CSS variable (next/font `.variable`); none for Hanken. */
  fontClassName?: string;
  /**
   * "screen" (public page): the document scrolls, <main> with her name as <h1>, cover preloaded.
   * "parent": a preview embedded in another page; fills its frame and scrolls inside it as the page would (phones),
   * renders as <div> without an <h1>, cover lazy.
   * Default "screen".
   */
  height?: "screen" | "parent";
  /** Prefix of element ids, unique per document (several previews on one page). Default "pro". */
  idPrefix?: string;
  /** Read and write ?onglet= in the address bar. Default true; false in previews. */
  syncUrl?: boolean;
  /** The tab shown first, when the page has it (a preview opening on the shop). Default the first tab. */
  initialTab?: TabId;

  /** Host shown in the link pill / bar: "kitoko.page". */
  host: string;
  /** Her own domain (Pro plan), shown alone in the pill / bar instead of host/handle. */
  domain?: string | null;
  /** The link Share hands out; default the address in the bar, without its query. */
  shareUrl?: string;
  pro: {
    name: string;
    handle: string;
    /** Her bio, one line. */
    tagline: string | null;
    /** Her photo; null shows her initials on the theme's accent. */
    avatar: PageImage | null;
    /** Her logo (sur-mesure, Pro plan): drawn instead of her name, which becomes its alt. */
    logo?: PageImage | null;
  };
  cover: PageCover | null;
  /** Gallery: the Photos tab, and the encadré strip after the cover. */
  photos: PageImage[];
  /** Instagram / WhatsApp pills in the header (bandeau, plein on desktop). */
  contacts: PageContact[];
  /** The facts line under her name, in every layout. Absent: `chips` are drawn on that line instead. */
  facts?: PageFacts | null;
  /** Older plain facts for callers without `facts` (previews): "4,9 sur 5", "Paris 18e", "Lundi au samedi". */
  chips?: string[];

  services: PageService[];
  /** Under the services, e.g. "Le prix et la durée se calculent selon tes options." */
  servicesNote?: string | null;
  /** Null hides the Avis tab. `summary` is "sur 5, 128 avis"; items newest first. */
  reviews: { average: string; summary: string; items: PageReview[] } | null;
  infos: PageInfo[];

  /** "Réserver": null hides the booking bar and the desktop card (no services). No href in previews. */
  book: { label: string; href?: string } | null;
  /** Desktop card: deposit line ("Acompte 30 € à la réservation. …"), and placeholder slot labels for previews. */
  card: { deposit: string | null; placeholderSlots?: string[] };
  /** Mobile bar placeholder value for previews ("Lun. 26, 9 h"). */
  placeholderNextSlot?: string;

  labels: ProPageLabels;

  /** The app's client islands. Each is optional: without it a static placeholder renders. */
  slots?: {
    /** Next to the address in the header: a demo page's "Démo" badge. */
    badge?: ReactNode;
    /** Header bag button (shop). */
    bag?: ReactNode;
    /** Mobile bar content, Réserver included (replaces the static next slot + Réserver). */
    bar?: ReactNode;
    /** Desktop card's slot chips (replaces placeholderSlots). */
    nextSlots?: ReactNode;
    /** Boutique panel content; its tab only shows when given. */
    shop?: ReactNode;
    /** "Page créée avec Kitoko", languages: under the panel (inside the panel area on phones). */
    footer?: ReactNode;
  };
};
