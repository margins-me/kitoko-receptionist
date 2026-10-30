import { AddonSchema, DepositRuleSchema, LocalizedTextSchema, OptionGroupSchema } from "@kitoko/booking";
import type { ServiceDef } from "@kitoko/booking";
import type { Db } from "./clients";
import type { Json } from "./types.gen";

type ServiceRow = {
  id: string;
  name: string;
  base_price_cents: number;
  base_minutes: number;
  option_groups: Json;
  addons: Json;
  conditions: Json;
  deposit: Json | null;
};

export function toServiceDef(row: ServiceRow): ServiceDef {
  return {
    id: row.id,
    name: { fr: row.name },
    basePriceCents: row.base_price_cents,
    baseMinutes: row.base_minutes,
    optionGroups: OptionGroupSchema.array().parse(row.option_groups),
    addons: AddonSchema.array().parse(row.addons),
    conditions: LocalizedTextSchema.array().parse(row.conditions),
    deposit: DepositRuleSchema.nullable().parse(row.deposit),
  };
}

/** A service with what the page, the agents and the calendar need besides the pricing engine's fields. */
export type ServiceListing = ServiceDef & {
  categoryId: string | null;
  description: string | null;
  /** App paths (/photos/...) or absolute URLs. */
  photos: string[];
  prepInstructions: string | null;
  active: boolean;
  position: number;
  /** The staff members who perform it (service_staff). */
  staffIds: string[];
};

export const SERVICE_COLUMNS = `id, category_id, name, description, photos, base_price_cents, base_minutes, option_groups, addons,
  conditions, prep_instructions, deposit, active, position, service_staff (staff_id)`;

export type ServiceListingRow = ServiceRow & {
  category_id: string | null;
  description: string | null;
  photos: string[];
  prep_instructions: string | null;
  active: boolean;
  position: number;
  service_staff: { staff_id: string }[];
};

export function toServiceListing(row: ServiceListingRow): ServiceListing {
  return {
    ...toServiceDef(row),
    categoryId: row.category_id,
    description: row.description,
    photos: row.photos,
    prepInstructions: row.prep_instructions,
    active: row.active,
    position: row.position,
    staffIds: row.service_staff.map((s) => s.staff_id).toSorted(),
  };
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/** A pro's services in menu order, active ones unless asked. Works with the anon client for a live pro. */
export async function listServices(db: Db, proId: string, opts: { includeInactive?: boolean } = {}): Promise<ServiceListing[]> {
  let query = db.from("services").select(SERVICE_COLUMNS).eq("pro_id", proId);
  if (!opts.includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data.toSorted(byPosition).map(toServiceListing);
}

/** One service of a pro, or null. */
export async function getService(db: Db, proId: string, serviceId: string): Promise<ServiceListing | null> {
  const { data, error } = await db.from("services").select(SERVICE_COLUMNS).eq("pro_id", proId).eq("id", serviceId).maybeSingle();
  if (error) throw error;
  return data ? toServiceListing(data) : null;
}
