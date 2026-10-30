import { toLocale } from "@kitoko/i18n";
import { DayHoursSchema, fromPrice, RulesSchema, ScheduleSchema } from "@kitoko/booking";
import type { DayHours, LocalDate, Locale, Rules, Schedule } from "@kitoko/booking";
import { busyIntervals } from "./bookings";
import type { BusyInterval } from "./bookings";
import type { Db } from "./clients";
import { CURRENCIES, oneOf } from "./rows";
import type { Currency } from "./rows";
import { SERVICE_COLUMNS, toServiceListing } from "./services";
import type { ServiceListing } from "./services";

export type Staff = { id: string; proId: string; name: string; color: string | null; position: number };

const STAFF_COLUMNS = "id, pro_id, name, color, position";

const toStaff = (row: { id: string; pro_id: string; name: string; color: string | null; position: number }): Staff => ({
  id: row.id,
  proId: row.pro_id,
  name: row.name,
  color: row.color,
  position: row.position,
});

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/** A pro's staff members in order (Bryntum resources). Works with the anon client for a live pro. */
export async function listStaff(db: Db, proId: string): Promise<Staff[]> {
  const { data, error } = await db.from("staff").select(STAFF_COLUMNS).eq("pro_id", proId);
  if (error) throw error;
  return data.toSorted(byPosition).map(toStaff);
}

/** A pro as the server works with her. Reads paypal_email: use the service client. */
export type Pro = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  trades: string[];
  locale: Locale;
  pageLocale: Locale;
  timezone: string;
  currency: Currency;
  city: string | null;
  areaLabel: string | null;
  avatarPath: string | null;
  coverPath: string | null;
  gallery: string[];
  rules: Rules;
  schedule: Schedule;
  whatsappE164: string | null;
  instagram: string | null;
  /** Where Payouts sends her money; null until she set it. */
  paypalEmail: string | null;
  publishedAt: number | null;
};

const PRO_COLUMNS = `id, handle, name, bio, trades, locale, page_locale, timezone, currency, city, area_label, avatar_path,
  cover_path, gallery, rules, schedule, whatsapp_e164, instagram, paypal_email, published_at`;

type ProRow = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  trades: string[];
  locale: string;
  page_locale: string;
  timezone: string;
  currency: string;
  city: string | null;
  area_label: string | null;
  avatar_path: string | null;
  cover_path: string | null;
  gallery: string[];
  rules: unknown;
  schedule: unknown;
  whatsapp_e164: string | null;
  instagram: string | null;
  paypal_email: string | null;
  published_at: string | null;
};

export function toPro(row: ProRow): Pro {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    trades: row.trades,
    locale: toLocale(row.locale),
    pageLocale: toLocale(row.page_locale),
    timezone: row.timezone,
    currency: oneOf(CURRENCIES, row.currency),
    city: row.city,
    areaLabel: row.area_label,
    avatarPath: row.avatar_path,
    coverPath: row.cover_path,
    gallery: row.gallery,
    rules: RulesSchema.parse(row.rules),
    schedule: ScheduleSchema.parse(row.schedule),
    whatsappE164: row.whatsapp_e164,
    instagram: row.instagram,
    paypalEmail: row.paypal_email,
    publishedAt: row.published_at === null ? null : Date.parse(row.published_at),
  };
}

/** A pro by handle (any case), or null. Service client. */
export async function getProByHandle(db: Db, handle: string): Promise<Pro | null> {
  const { data, error } = await db.from("pros").select(PRO_COLUMNS).eq("handle", handle.toLowerCase()).maybeSingle();
  if (error) throw error;
  return data ? toPro(data) : null;
}

/** A pro by id, or null. Service client. */
export async function getPro(db: Db, id: string): Promise<Pro | null> {
  const { data, error } = await db.from("pros").select(PRO_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toPro(data) : null;
}

/** A live pro for the landing page and the MCP search_pros tool. */
export type ProListing = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  city: string | null;
  areaLabel: string | null;
  trades: string[];
  currency: Currency;
  locale: Locale;
  timezone: string;
  avatarPath: string | null;
  coverPath: string | null;
  /** Active services in menu order, with their "from" price (cheapest options) and duration range. */
  services: { id: string; name: string; fromPriceCents: number; minMinutes: number; maxMinutes: number }[];
};

/**
 * Published pros, filtered by city (case-insensitive), trade id (packages/booking TRADES), currency, or free text
 * (name, bio, city, area, service names). Works with the anon client.
 */
export async function listPros(
  db: Db,
  filter: { city?: string; trade?: string; currency?: Currency; query?: string } = {},
): Promise<ProListing[]> {
  let query = db
    .from("pros")
    .select(
      `id, handle, name, bio, city, area_label, trades, currency, locale, timezone, avatar_path, cover_path, published_at,
       services (${SERVICE_COLUMNS})`,
    )
    .not("published_at", "is", null)
    .eq("services.active", true);
  if (filter.city) query = query.ilike("city", filter.city.trim());
  if (filter.trade) query = query.contains("trades", [filter.trade]);
  if (filter.currency) query = query.eq("currency", filter.currency);
  const { data, error } = await query.order("name");
  if (error) throw error;
  const listings = data.map(
    (row): ProListing => ({
      id: row.id,
      handle: row.handle,
      name: row.name,
      bio: row.bio,
      city: row.city,
      areaLabel: row.area_label,
      trades: row.trades,
      currency: oneOf(CURRENCIES, row.currency),
      locale: toLocale(row.locale),
      timezone: row.timezone,
      avatarPath: row.avatar_path,
      coverPath: row.cover_path,
      services: row.services
        .map(toServiceListing)
        .toSorted(byPosition)
        .map((s) => {
          const from = fromPrice(s);
          return { id: s.id, name: s.name.fr, fromPriceCents: from.priceCents, minMinutes: from.minMinutes, maxMinutes: from.maxMinutes };
        }),
    }),
  );
  const text = filter.query?.trim().toLowerCase();
  if (!text) return listings;
  return listings.filter((p) =>
    [p.name, p.bio, p.city, p.areaLabel, ...p.services.map((s) => s.name)].some((v) => v?.toLowerCase().includes(text)),
  );
}

/**
 * The raw appearance columns, exactly what parseAppearance (@kitoko/themes) takes:
 * `parseAppearance(page.pro.appearance)` gives the PageAppearance Kitoko's getProPage returned.
 */
export type AppearanceInput = {
  layout: string | null;
  style: string;
  theme: string;
  titleFont: string | null;
  coverPath: string | null;
  focalX: number;
  focalY: number;
  coverWidth: number | null;
  coverHeight: number | null;
  gallery: string[];
};

export type PageService = ServiceListing;

export type ProPage = {
  pro: {
    id: string;
    handle: string;
    name: string;
    bio: string | null;
    areaLabel: string | null;
    city: string | null;
    timezone: string;
    currency: Currency;
    locale: Locale;
    /** The language she writes her page in: the page's language for bots and unsupported devices. */
    pageLocale: Locale;
    /** App paths (/photos/...) or absolute URLs. */
    avatarPath: string | null;
    coverPath: string | null;
    gallery: string[];
    appearance: AppearanceInput;
    trades: string[];
    hideAddress: boolean;
    rules: Rules;
    schedule: Schedule;
    whatsappE164: string | null;
    /** Without the @. */
    instagram: string | null;
    /** Always true here: every pro takes deposits through PayPal. */
    paymentsEnabled: true;
  };
  staff: Staff[];
  categories: { id: string; name: string; position: number }[];
  services: PageService[];
};

/** A live pro's public page by handle, or null. Use the anon client: RLS hides unpublished pros and inactive services. */
export async function getProPage(db: Db, handle: string): Promise<ProPage | null> {
  const { data: row, error } = await db
    .from("pros")
    .select(
      `id, handle, name, bio, area_label, city, timezone, currency, locale, page_locale, avatar_path, cover_path, gallery,
       trades, layout, style, theme, title_font, cover_focal_x, cover_focal_y, cover_width, cover_height,
       hide_address, rules, schedule, whatsapp_e164, instagram,
       staff (${STAFF_COLUMNS}),
       categories (id, name, position),
       services (${SERVICE_COLUMNS})`,
    )
    .eq("handle", handle.toLowerCase())
    .eq("services.active", true)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  return {
    pro: {
      id: row.id,
      handle: row.handle,
      name: row.name,
      bio: row.bio,
      areaLabel: row.area_label,
      city: row.city,
      timezone: row.timezone,
      currency: oneOf(CURRENCIES, row.currency),
      locale: toLocale(row.locale),
      pageLocale: toLocale(row.page_locale),
      avatarPath: row.avatar_path,
      coverPath: row.cover_path,
      gallery: row.gallery,
      appearance: {
        layout: row.layout,
        style: row.style,
        theme: row.theme,
        titleFont: row.title_font,
        coverPath: row.cover_path,
        focalX: row.cover_focal_x,
        focalY: row.cover_focal_y,
        coverWidth: row.cover_width,
        coverHeight: row.cover_height,
        gallery: row.gallery,
      },
      trades: row.trades,
      hideAddress: row.hide_address,
      rules: RulesSchema.parse(row.rules),
      schedule: ScheduleSchema.parse(row.schedule),
      whatsappE164: row.whatsapp_e164,
      instagram: row.instagram,
      paymentsEnabled: true,
    },
    staff: row.staff.map(toStaff).toSorted(byPosition),
    categories: row.categories.toSorted(byPosition),
    services: row.services.map(toServiceListing).toSorted(byPosition),
  };
}

export type AvailabilityInputs = {
  busy: BusyInterval[];
  overrides: Record<LocalDate, DayHours | null>;
};

const DAY = 86_400_000;
const utcDate = (at: number): LocalDate => new Date(at).toISOString().slice(0, 10);

/**
 * What the slot engine needs for [from, to) besides the schedule: busy intervals (of one staff member, or all with
 * their staff ids) and day overrides covering every local date in the range, in any time zone.
 */
export async function getAvailabilityInputs(
  db: Db,
  i: { proId: string; staffId?: string | null; from: number; to: number },
): Promise<AvailabilityInputs> {
  const [busy, overrides] = await Promise.all([
    busyIntervals(db, i),
    db
      .from("day_overrides")
      .select("day, hours")
      .eq("pro_id", i.proId)
      .gte("day", utcDate(i.from - DAY))
      .lte("day", utcDate(i.to + DAY))
      .throwOnError(),
  ]);
  return {
    busy,
    overrides: Object.fromEntries(overrides.data.map((o) => [o.day, DayHoursSchema.nullable().parse(o.hours)])),
  };
}
