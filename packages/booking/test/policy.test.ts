import { describe, expect, it } from "vitest";
import { cancellationOutcome, rescheduleEligibility } from "../src/policy";
import type { CancellationTier } from "../src/schemas";
import { paris, rules } from "./fixtures";

const H = 3_600_000;
const startsAt = paris("2026-10-26", "10:00");
const paid = { serviceCents: 3000, productsCents: 1800, deliveryCents: 0 };
const cancel = (now: number, tiers: CancellationTier[] = rules.cancellation, p = paid) =>
  cancellationOutcome({ startsAt, now, tiers, paid: p });

describe("cancellationOutcome", () => {
  it("starts in CET, after the 25 Oct change", () => {
    expect(startsAt).toBe(Date.UTC(2026, 9, 26, 9));
  });

  it("refunds everything well ahead", () => {
    expect(cancel(startsAt - 72 * H, rules.cancellation, { ...paid, deliveryCents: 490 })).toEqual({
      ok: true,
      value: { keepPercent: 0, keptCents: 0, refundCents: 5290 },
    });
  });

  it("is free at exactly 48 h", () => {
    expect(cancel(startsAt - 48 * H)).toEqual({ ok: true, value: { keepPercent: 0, keptCents: 0, refundCents: 4800 } });
  });

  it("keeps the service but refunds products just inside 48 h", () => {
    expect(cancel(startsAt - 48 * H + 60_000)).toEqual({
      ok: true,
      value: { keepPercent: 100, keptCents: 3000, refundCents: 1800 },
    });
  });

  it("rounds the kept part in the client's favour, whatever the tier order", () => {
    const tiers = [
      { minHoursBefore: 0, keepPercent: 100 },
      { minHoursBefore: 48, keepPercent: 0 },
      { minHoursBefore: 24, keepPercent: 50 },
    ];
    expect(cancel(startsAt - 30 * H, tiers, { serviceCents: 3001, productsCents: 0, deliveryCents: 0 })).toEqual({
      ok: true,
      value: { keepPercent: 50, keptCents: 1500, refundCents: 1501 },
    });
  });

  it("keeps everything when no tier matches", () => {
    const r = cancel(startsAt - H, [{ minHoursBefore: 24, keepPercent: 0 }]);
    expect(r.ok && r.value.keepPercent).toBe(100);
  });

  it("refuses once the appointment has started", () => {
    expect(cancel(startsAt)).toEqual({ ok: false, error: "already_started" });
    expect(cancel(startsAt + H)).toEqual({ ok: false, error: "already_started" });
  });

  it("counts real hours, not wall-clock hours, across the DST change", () => {
    const free = { ok: true, value: { keepPercent: 0, keptCents: 0, refundCents: 4800 } };
    expect(cancel(paris("2026-10-24", "10:00"))).toEqual(free);
    // Wall clock says 47 h before, but 48 real hours remain.
    expect(cancel(paris("2026-10-24", "11:00"))).toEqual(free);
    expect(cancel(paris("2026-10-24", "11:01"))).toMatchObject({ ok: true, value: { keepPercent: 100 } });
  });
});

describe("rescheduleEligibility", () => {
  const check = (hoursBefore: number, count: number, rule = rules.reschedule) =>
    rescheduleEligibility({ startsAt, now: startsAt - hoursBefore * H, count, rule });

  it("applies count and notice", () => {
    expect(check(72, 0)).toEqual({ ok: true });
    expect(check(72, 1)).toEqual({ ok: false, reason: "limit_reached" });
    expect(check(47, 0)).toEqual({ ok: false, reason: "too_late" });
    expect(check(48, 0)).toEqual({ ok: true });
    expect(check(71, 0, { maxCount: 1, minHoursBefore: 72 })).toEqual({ ok: false, reason: "too_late" });
  });

  it("refuses once the appointment has started, before any other check", () => {
    expect(check(0, 0)).toEqual({ ok: false, reason: "past" });
    expect(check(-1, 5)).toEqual({ ok: false, reason: "past" });
  });
});
