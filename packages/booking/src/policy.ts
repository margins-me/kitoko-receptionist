import { err, ok } from "./result";
import type { Result } from "./result";
import type { CancellationTier, Rules } from "./schemas";
import type { Instant } from "./time";

const HOUR = 3_600_000;

export function cancellationOutcome(i: {
  startsAt: Instant;
  now: Instant;
  tiers: CancellationTier[];
  paid: { serviceCents: number; productsCents: number; deliveryCents: number };
}): Result<{ keepPercent: number; keptCents: number; refundCents: number }, "already_started"> {
  if (i.now >= i.startsAt) return err("already_started");
  const before = i.startsAt - i.now;
  const tier = i.tiers
    .toSorted((a, b) => b.minHoursBefore - a.minHoursBefore)
    .find((t) => before >= t.minHoursBefore * HOUR);
  const keepPercent = tier?.keepPercent ?? 100;
  const keptCents = Math.floor((i.paid.serviceCents * keepPercent) / 100);
  const refundCents = i.paid.serviceCents - keptCents + i.paid.productsCents + i.paid.deliveryCents;
  return ok({ keepPercent, keptCents, refundCents });
}

export function rescheduleEligibility(i: {
  startsAt: Instant;
  now: Instant;
  count: number;
  rule: Rules["reschedule"];
}): { ok: true } | { ok: false; reason: "past" | "limit_reached" | "too_late" } {
  if (i.now >= i.startsAt) return { ok: false, reason: "past" };
  if (i.count >= i.rule.maxCount) return { ok: false, reason: "limit_reached" };
  if (i.startsAt - i.now < i.rule.minHoursBefore * HOUR) return { ok: false, reason: "too_late" };
  return { ok: true };
}
