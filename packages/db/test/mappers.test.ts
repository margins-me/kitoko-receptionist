import { describe, expect, it } from "vitest";
import { toBookingDetail } from "../src/bookings";
import type { BookingRow } from "../src/bookings";
import { toAgentEvent, toConversation, toMessage, toPendingAction } from "../src/conversations";
import { toServiceDef, toServiceListing } from "../src/services";

const rules = {
  deposit: { mode: "fixed", cents: 3000 },
  feePayer: "client",
  reschedule: { maxCount: 1, minHoursBefore: 48 },
  cancellation: [
    { minHoursBefore: 48, keepPercent: 0 },
    { minHoursBefore: 0, keepPercent: 100 },
  ],
  lateness: { graceMinutes: 15, feeCents: null, autoCancelAfterMinutes: null },
  balanceMethods: ["cash", "external"],
  companionsAllowed: false,
  extra: [],
};

const bookingRow = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: "b1",
  ref: "ABC234",
  pro_id: "pro",
  staff_id: "s1",
  service_id: "svc",
  client_id: "c1",
  conversation_id: "conv",
  status: "confirmed",
  during: '["2030-01-07 09:00:00+00","2030-01-07 10:30:00+00")',
  hold_expires_at: null,
  source: "web",
  selection: {
    selection: { options: {}, addons: [], conditionsAccepted: true },
    lines: [{ kind: "base", id: "svc", label: { fr: "Cornrows" }, priceCents: 4500, minutes: 90 }],
  },
  policy: rules,
  price_cents: 4500,
  deposit_cents: 3000,
  fee_cents: 150,
  currency: "EUR",
  locale: "it",
  reschedule_count: 0,
  displaced_at: "2030-01-05T08:00:00+00:00",
  moved_from: null,
  moved_by: null,
  cancelled_at: null,
  cancelled_by: null,
  cancel_reason: null,
  created_at: "2030-01-01T08:00:00+00:00",
  services: { id: "svc", name: "Cornrows" },
  staff: [{ id: "s1", name: "Aïcha", color: "#9E3F1C" }],
  clients: { id: "c1", first_name: "Giulia", phone_e164: "+393450000016", email: null, locale: "it" },
  conversations: { token: "demo-aicha-client-1" },
  payments: [],
  refunds: [],
  payouts: [],
  ...over,
});

describe("toBookingDetail", () => {
  it("maps a booking with its embeds", () => {
    const b = toBookingDetail(bookingRow());
    expect(b).toMatchObject({
      ref: "ABC234",
      status: "confirmed",
      start: Date.UTC(2030, 0, 7, 9),
      end: Date.UTC(2030, 0, 7, 10, 30),
      balanceCents: 1500,
      currency: "EUR",
      locale: "it",
      displacedAt: Date.UTC(2030, 0, 5, 8),
      service: { id: "svc", name: "Cornrows" },
      staff: { id: "s1", name: "Aïcha", color: "#9E3F1C" },
      client: { id: "c1", firstName: "Giulia", phoneE164: "+393450000016", email: null, locale: "it" },
      conversationToken: "demo-aicha-client-1",
      money: { paidCents: 0, payoutCents: null },
    });
    expect(b.policy.cancellation).toHaveLength(2);
  });

  it("maps a hold without a client", () => {
    const b = toBookingDetail(bookingRow({ status: "held", client_id: null, clients: null, conversations: null, hold_expires_at: "2030-01-01T08:15:00+00:00" }));
    expect(b.client).toBeNull();
    expect(b.conversationToken).toBeNull();
    expect(b.holdExpiresAt).toBe(Date.UTC(2030, 0, 1, 8, 15));
  });

  it("refuses an unknown status or a broken snapshot", () => {
    expect(() => toBookingDetail(bookingRow({ status: "awaiting_deposit" }))).toThrow();
    expect(() => toBookingDetail(bookingRow({ policy: {} }))).toThrow();
  });
});

describe("services", () => {
  const row = {
    id: "svc",
    name: "Knotless braids",
    base_price_cents: 8500,
    base_minutes: 240,
    option_groups: [
      {
        id: "taille",
        label: { fr: "Taille des tresses", en: "Braid size", it: "Misura delle trecce" },
        default: "m",
        options: [
          { id: "l", label: { fr: "L, épaisses", en: "L, large", it: "L, grandi" }, priceCents: 0, minutes: 0 },
          { id: "m", label: { fr: "M, moyennes", en: "M, medium", it: "M, medie" }, priceCents: 2500, minutes: 90 },
        ],
      },
    ],
    addons: [{ id: "shampoing", label: { fr: "Shampoing", en: "Shampoo", it: "Shampoo" }, priceCents: 1000, minutes: 20 }],
    conditions: [],
    deposit: null,
  };

  it("parses the menu JSON, Italian labels included", () => {
    const def = toServiceDef(row);
    expect(def.name).toEqual({ fr: "Knotless braids" });
    expect(def.optionGroups[0]?.label.it).toBe("Misura delle trecce");
    expect(def.addons).toHaveLength(1);
  });

  it("lists the staff who perform a service", () => {
    const listing = toServiceListing({
      ...row,
      category_id: null,
      description: null,
      photos: ["/photos/tresses-pose-sourire.jpg"],
      prep_instructions: null,
      active: true,
      position: 0,
      service_staff: [{ staff_id: "s2" }, { staff_id: "s1" }],
    });
    expect(listing.staffIds).toEqual(["s1", "s2"]);
    expect(listing.photos).toEqual(["/photos/tresses-pose-sourire.jpg"]);
  });
});

describe("agent rows", () => {
  it("maps a conversation, a message, an event and a pending action", () => {
    expect(
      toConversation({
        id: "conv",
        pro_id: "pro",
        kind: "client",
        channel: "whatsapp",
        external_id: "393450000016",
        client_id: null,
        locale: "xx",
        token: "t".repeat(64),
        last_message_at: null,
        created_at: "2030-01-01T08:00:00+00:00",
      }),
    ).toMatchObject({ channel: "whatsapp", locale: "en", lastMessageAt: null });
    expect(
      toMessage({ id: 7, conversation_id: "conv", role: "user", content: [{ type: "text", text: "Ciao" }], visible: false, created_at: "2030-01-01T08:00:00+00:00" }),
    ).toMatchObject({ id: 7, role: "user", visible: false });
    expect(
      toAgentEvent({ id: 1, pro_id: null, conversation_id: null, booking_id: null, kind: "tool", name: "search_pros", input: {}, output: null, ms: 4, created_at: "2030-01-01T08:00:00+00:00" }),
    ).toMatchObject({ kind: "tool", name: "search_pros", ms: 4 });
    expect(
      toPendingAction({
        id: "a1",
        pro_id: "pro",
        conversation_id: null,
        booking_id: null,
        kind: "refund",
        summary: "Refund 10 EUR",
        amount_cents: 1000,
        currency: "EUR",
        payload: {},
        status: "pending",
        decided_at: null,
        result: null,
        created_at: "2030-01-01T08:00:00+00:00",
      }),
    ).toMatchObject({ kind: "refund", amountCents: 1000, currency: "EUR", status: "pending", decidedAt: null });
    expect(() => toMessage({ id: 1, conversation_id: "c", role: "system", content: "x", visible: true, created_at: "2030-01-01T08:00:00+00:00" })).toThrow();
  });
});
