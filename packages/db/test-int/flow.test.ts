import { bookingFee, depositDue, quote } from "@kitoko/booking";
import { afterAll, describe, expect, it } from "vitest";
import {
  cancelBooking,
  createHold,
  getBooking,
  getProByHandle,
  listPendingPayouts,
  listPendingRefunds,
  listServices,
  markHonoured,
  payoutSent,
  payoutStatus,
  paypalCaptureCompleted,
  paypalPrepare,
  refundFinished,
  releaseHold,
} from "../src";
import { cleanup, KEMI, SERVICES, STAFF, svc } from "./fixtures";

// Kemi, far in the future so the demo week is untouched
const DAY = Date.UTC(2031, 2, 4);
const from = DAY;
const to = DAY + 3 * 86_400_000;

afterAll(() => cleanup(KEMI, from, to));

async function holdGel(start: number) {
  const db = svc();
  const pro = (await getProByHandle(db, "kemi.nails"))!;
  const service = (await listServices(db, KEMI)).find((s) => s.id === SERVICES.kemiGel)!;
  const selection = { options: {}, addons: [], conditionsAccepted: true };
  const q = quote(service, selection);
  if (!q.ok) throw new Error(q.error);
  const depositCents = depositDue(q.value.priceCents, service.deposit ?? pro.rules.deposit);
  const hold = await createHold(db, {
    proId: KEMI,
    serviceId: service.id,
    start,
    minutes: q.value.minutes,
    selection: { selection, lines: q.value.lines },
    policy: pro.rules,
    priceCents: q.value.priceCents,
    depositCents,
    feeCents: bookingFee(depositCents),
    source: "web",
    locale: "en",
  });
  return { hold, depositCents, priceCents: q.value.priceCents, minutes: q.value.minutes };
}

describe("hold, pay, confirm, cancel, refund", () => {
  it("runs the whole client flow", async () => {
    const db = svc();
    const { hold, depositCents, priceCents, minutes } = await holdGel(DAY + 10 * 3_600_000);
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    expect(hold.value.ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(hold.value.staffId).toBe(STAFF.kemi);
    expect(hold.value.holdExpiresAt - Date.now()).toBeGreaterThan(14 * 60_000);
    expect([priceCents, minutes, depositCents]).toEqual([5600, 120, 3000]);

    const again = await holdGel(DAY + 11 * 3_600_000);
    expect(again.hold).toEqual({ ok: false, error: "slot_taken" });

    const orderId = `TEST-ORDER-${hold.value.id}`;
    const prepared = await paypalPrepare(db, hold.value.id, orderId);
    expect(prepared.ok).toBe(true);

    expect(
      await paypalCaptureCompleted(db, { orderId, captureId: `TEST-CAP-${hold.value.id}`, amountCents: 3000, currency: "GBP" }),
    ).toEqual({ ok: false, error: "amount_mismatch" });

    const payer = { name: { given_name: "Ada", surname: "Test" }, email_address: "ada.test@example.com" };
    const captured = await paypalCaptureCompleted(db, { orderId, captureId: `TEST-CAP-${hold.value.id}`, amountCents: 3150, currency: "GBP", payer });
    expect(captured).toMatchObject({ ok: true, value: { bookingId: hold.value.id, outcome: "confirmed" } });
    const replay = await paypalCaptureCompleted(db, { orderId, captureId: `TEST-CAP-${hold.value.id}`, amountCents: 3150, currency: "GBP", payer });
    expect(replay).toMatchObject({ ok: true, value: { outcome: "already_captured" } });

    const confirmed = (await getBooking(db, hold.value.id))!;
    expect(confirmed).toMatchObject({
      status: "confirmed",
      ref: hold.value.ref,
      depositCents: 3000,
      feeCents: 150,
      balanceCents: 2600,
      currency: "GBP",
      staff: { name: "Kemi" },
      service: { name: "Gel extensions" },
      client: { firstName: "Ada", email: "ada.test@example.com" },
      money: { paidCents: 3150, refundedCents: 0, captureId: `TEST-CAP-${hold.value.id}` },
    });

    const cancelled = await cancelBooking(db, { bookingId: hold.value.id, by: "client" });
    expect(cancelled).toEqual({ ok: true, value: { refundCents: 3000, keptCents: 0 } });
    expect(await cancelBooking(db, { bookingId: hold.value.id, by: "client" })).toEqual({ ok: false, error: "not_cancellable" });

    const [refund] = await listPendingRefunds(db, { bookingId: hold.value.id });
    expect(refund).toMatchObject({ amountCents: 3000, currency: "GBP", reason: "client_cancel", captureId: `TEST-CAP-${hold.value.id}` });
    expect(await refundFinished(db, { refundId: refund!.id, paypalRefundId: `TEST-REFUND-${hold.value.id}`, status: "succeeded" })).toEqual({
      ok: true,
      value: undefined,
    });
    const after = (await getBooking(db, hold.value.id))!;
    expect(after.status).toBe("cancelled");
    expect(after.money).toMatchObject({ paidCents: 3150, refundedCents: 3000, refundPending: false, payoutCents: null });
    expect(await listPendingRefunds(db, { bookingId: hold.value.id })).toEqual([]);
  });

  it("pays the pro out when the booking is done", async () => {
    const db = svc();
    const { hold } = await holdGel(DAY + 86_400_000 + 10 * 3_600_000);
    if (!hold.ok) throw new Error(hold.error);
    const orderId = `TEST-ORDER-${hold.value.id}`;
    await paypalPrepare(db, hold.value.id, orderId);
    await paypalCaptureCompleted(db, { orderId, captureId: `TEST-CAP-${hold.value.id}`, amountCents: 3150, currency: "GBP", payer: { name: { given_name: "Bea" } } });

    const marked = await markHonoured(db, hold.value.id);
    expect(marked.ok && marked.value.payoutId).toBeTruthy();
    const [job] = await listPendingPayouts(db, { bookingId: hold.value.id });
    expect(job).toMatchObject({ amountCents: 3000, feeCents: 150, currency: "GBP", reason: "honoured", paypalEmail: "kitoko-kemi@business.example.com" });

    expect(await payoutSent(db, { payoutId: job!.id, batchId: "TEST-BATCH", itemId: `TEST-ITEM-${hold.value.id}` })).toEqual({ ok: true, value: undefined });
    expect(await payoutStatus(db, { itemId: `TEST-ITEM-${hold.value.id}`, status: "succeeded" })).toEqual({ ok: true, value: undefined });
    expect((await getBooking(db, hold.value.id))!.money).toMatchObject({ payoutCents: 3000, payoutStatus: "succeeded" });
    expect(await payoutStatus(db, { itemId: "TEST-ITEM-unknown", status: "failed" })).toEqual({ ok: false, error: "not_found" });
  });

  it("lets go of a replaced hold", async () => {
    const db = svc();
    const { hold } = await holdGel(DAY + 2 * 86_400_000 + 10 * 3_600_000);
    if (!hold.ok) throw new Error(hold.error);
    expect(await releaseHold(db, hold.value.id)).toEqual({ ok: true, value: undefined });
    expect((await getBooking(db, hold.value.id))!.status).toBe("expired");
    expect(await paypalPrepare(db, "e0000000-0000-4000-8000-0000000000ff", "TEST-ORDER-none")).toEqual({ ok: false, error: "not_found" });
  });
});
