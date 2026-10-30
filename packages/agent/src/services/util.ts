import { formatMoney, intlLocale, resolveLocal } from "@kitoko/booking";
import type { Currency, Locale } from "@kitoko/booking";
import { logAgentEvent } from "@kitoko/db";
import type { Json } from "@kitoko/db";
import type { ServicesCtx } from "./ctx";

/** A moment as services take it: epoch ms, a Date, an ISO string, or "YYYY-MM-DDTHH:MM" local to `tz` when given. */
export type When = number | string | Date;

const LOCAL = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/;

/** Epoch ms, or NaN. A string without an offset is read in `tz` (default UTC). */
export function toEpoch(at: When, tz?: string): number {
  if (typeof at === "number") return at;
  if (at instanceof Date) return at.getTime();
  const local = LOCAL.exec(at.trim());
  if (local && tz) {
    try {
      return resolveLocal(local[1]!, local[2] ?? "00:00", tz).at;
    } catch {
      return NaN;
    }
  }
  return Date.parse(local && !local[2] ? `${local[1]}T00:00:00Z` : at);
}

export const iso = (at: number): string => new Date(at).toISOString();

export const nowMs = (ctx: ServicesCtx): number => ctx.now().getTime();

/** "Saturday 31 October, 09:00" in the reader's language, local to the salon. */
export function localLabel(at: number, tz: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

/** The app's money text ("30 €", "€30"), with plain spaces. */
export const moneyText = (cents: number, locale: Locale, currency: Currency): string =>
  formatMoney(cents, locale, currency).replace(/\s/g, " ");

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** Plain JSON for jsonb columns (drops undefined, turns Dates into strings). */
export const toJson = (value: unknown): Json => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json));

/** agent_events row; never throws (the timeline is a nice-to-have, never a reason to fail a booking). */
export async function logEvent(
  ctx: ServicesCtx,
  e: { kind: "tool" | "model" | "paypal" | "error" | "system"; name: string; proId?: string | null; conversationId?: string | null; bookingId?: string | null; input?: unknown; output?: unknown; ms?: number },
): Promise<void> {
  try {
    await logAgentEvent(ctx.db, {
      kind: e.kind,
      name: e.name,
      proId: e.proId ?? null,
      conversationId: e.conversationId ?? null,
      bookingId: isUuid(e.bookingId) ? e.bookingId : null,
      ...(e.input !== undefined ? { input: toJson(e.input) } : {}),
      ...(e.output !== undefined ? { output: toJson(e.output) } : {}),
      ...(e.ms !== undefined ? { ms: e.ms } : {}),
    });
  } catch (err) {
    console.warn("[services] agent_events insert failed", e.name, err);
  }
}
