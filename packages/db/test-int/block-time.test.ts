import { afterAll, describe, expect, it } from "vitest";
import {
  blockTime,
  busyIntervals,
  cancelBooking,
  confirmBooking,
  createHold,
  getProByHandle,
  listBookings,
  paypalCaptureCompleted,
  paypalPrepare,
  rescheduleBooking,
} from "../src";
import { cleanup, NALA, SERVICES, STAFF, svc } from "./fixtures";

const DAY = Date.UTC(2031, 3, 8);
const HOUR = 3_600_000;
afterAll(() => cleanup(NALA, DAY, DAY + 3 * 86_400_000));

async function book(serviceId: string, start: number, minutes: number, firstName: string, pay: boolean) {
  const db = svc();
  const pro = (await getProByHandle(db, "studio-nala"))!;
  const hold = await createHold(db, {
    proId: NALA,
    serviceId,
    start,
    minutes,
    selection: {
      selection: { options: {}, addons: [], conditionsAccepted: true },
      lines: [{ kind: "base", id: serviceId, label: { fr: "Test" }, priceCents: 4500, minutes }],
    },
    policy: pro.rules,
    priceCents: 4500,
    depositCents: 3000,
    feeCents: 150,
    source: "web",
  });
  if (!hold.ok) throw new Error(hold.error);
  if (pay) {
    await paypalPrepare(db, hold.value.id, `TEST-ORDER-${hold.value.id}`);
    await paypalCaptureCompleted(db, {
      orderId: `TEST-ORDER-${hold.value.id}`,
      captureId: `TEST-CAP-${hold.value.id}`,
      amountCents: 3150,
      currency: "EUR",
      payer: { name: { given_name: firstName } },
    });
  } else {
    await confirmBooking(db, { bookingId: hold.value.id, firstName });
  }
  return hold.value;
}

describe("sick day", () => {
  it("displaces only the sick staff member's bookings, then moves or refunds them", async () => {
    const db = svc();
    const braids = await book(SERVICES.nalaNattes, DAY + 9 * HOUR, 90, "Awa", false);
    const nails = await book(SERVICES.nalaSemi, DAY + 9 * HOUR, 60, "Ines", true);
    const nails2 = await book(SERVICES.nalaSemi, DAY + 13 * HOUR, 60, "Mia", true);
    expect(braids.staffId).toBe(STAFF.nala);
    expect(nails.staffId).toBe(STAFF.sira);

    const blocked = await blockTime(db, { proId: NALA, staffId: STAFF.sira, start: DAY, end: DAY + 86_400_000, label: "Sira sick" });
    expect(blocked).toEqual({ ok: true, value: { displacedBookingIds: [nails.id, nails2.id] } });

    const day = await listBookings(db, NALA, DAY, DAY + 86_400_000);
    expect(day.map((b) => [b.staff.name, b.displacedAt !== null])).toEqual([
      ["Nala", false],
      ["Sira", true],
      ["Sira", true],
    ]);
    expect(await listBookings(db, NALA, DAY, DAY + 86_400_000, { staffId: STAFF.nala })).toHaveLength(1);

    const busy = await busyIntervals(db, { proId: NALA, staffId: STAFF.sira, from: DAY, to: DAY + 86_400_000 });
    expect(busy).toContainEqual({ start: DAY, end: DAY + 86_400_000, staffId: STAFF.sira });

    // the client picks a slot the next day
    expect(await rescheduleBooking(db, { bookingId: nails.id, start: DAY + 9 * HOUR, by: "client" })).toEqual({
      ok: false,
      error: "slot_blocked",
    });
    expect(await rescheduleBooking(db, { bookingId: nails.id, start: DAY + 86_400_000 + 9 * HOUR, by: "client" })).toEqual({
      ok: true,
      value: { staffId: STAFF.sira },
    });
    // the other declines: the pro cancels, everything is refunded
    expect(await cancelBooking(db, { bookingId: nails2.id, by: "pro", reason: "declined_move" })).toEqual({
      ok: true,
      value: { refundCents: 3150, keptCents: 0 },
    });

    const after = await listBookings(db, NALA, DAY, DAY + 2 * 86_400_000, { statuses: ["confirmed", "cancelled"] });
    const moved = after.find((b) => b.id === nails.id)!;
    expect(moved).toMatchObject({ displacedAt: null, rescheduleCount: 0, movedBy: "client", movedFrom: DAY + 9 * HOUR });
    expect(after.find((b) => b.id === nails2.id)).toMatchObject({ status: "cancelled", money: { refundedCents: 3150, refundPending: true } });
  });

  it("reports an unknown staff member", async () => {
    expect(await blockTime(svc(), { proId: NALA, staffId: STAFF.kemi, start: DAY, end: DAY + HOUR })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
