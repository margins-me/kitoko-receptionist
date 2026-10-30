import "server-only";
import { fromPrice } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import { getPro, listServices } from "@kitoko/db";
import type { ServiceListing } from "@kitoko/db";
import { freeStarts } from "./booking";
import type { ServicesCtx } from "./ctx";
import { toEpoch } from "./util";
import type { When } from "./util";

/** A start a new booking could take, per staff member: what the calendar marks at rest. */
export type BookableStart = { start: number; staffId: string; minutes: number };

/**
 * The starts a default-length booking could take over [from, to), per staff member, from now on. "Default length"
 * is each staff member's shortest active service (its cheapest options, `fromPrice`): if even that does not fit at a
 * start, nothing she offers does, so a tick means "a client could book here". Her hours, fixed start times, breaks,
 * blocks and bookings all apply, exactly as for findSlots.
 */
export async function bookableStarts(ctx: ServicesCtx, i: { proId: string; from: When; to: When }): Promise<Result<BookableStart[], string>> {
  const pro = await getPro(ctx.db, i.proId);
  if (!pro) return err("pro_not_found");
  const from = toEpoch(i.from, pro.timezone);
  const to = toEpoch(i.to, pro.timezone);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return err("invalid_dates");

  const services = await listServices(ctx.db, pro.id);
  // Each staff member's shortest service; staff sharing it are looked up together.
  const shortest = new Map<string, { service: ServiceListing; minutes: number }>();
  for (const service of services) {
    const minutes = fromPrice(service).minMinutes;
    for (const staffId of service.staffIds) {
      const best = shortest.get(staffId);
      if (!best || minutes < best.minutes) shortest.set(staffId, { service, minutes });
    }
  }
  const byService = new Map<string, { service: ServiceListing; minutes: number; staff: Set<string> }>();
  for (const [staffId, pick] of shortest) {
    const entry = byService.get(pick.service.id) ?? { ...pick, staff: new Set<string>() };
    entry.staff.add(staffId);
    byService.set(pick.service.id, entry);
  }

  const out: BookableStart[] = [];
  await Promise.all(
    [...byService.values()].map(async ({ service, minutes, staff }) => {
      const slots = await freeStarts(ctx, { pro, service: { ...service, staffIds: [...staff] }, minutes, from, to });
      for (const s of slots) for (const staffId of s.staffIds) if (staff.has(staffId)) out.push({ start: s.start, staffId, minutes });
    }),
  );
  return ok(out.sort((a, b) => a.start - b.start || a.staffId.localeCompare(b.staffId)));
}
