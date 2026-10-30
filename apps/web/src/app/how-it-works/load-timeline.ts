import "server-only";
import { getBooking, getBookingByRef, listAgentEvents, serviceClient } from "@kitoko/db";
import type { BookingDetail, Db, Json } from "@kitoko/db";
import { formatMoney } from "@kitoko/booking";

// The "How it works" timeline of one booking: agent tool calls (agent_events), PayPal webhooks (paypal_events) and
// the booking's own milestones, interleaved by time. Public page: no client data beyond the first name, no booking id.

export const DEMO_HANDLE = "aicha.braids";

export type Selector = { ref?: string; b?: string };

export type TimelineItem = {
  id: string;
  at: number;
  kind: "agent" | "paypal" | "booking" | "error";
  title: string;
  /** Short "key: value" summaries of the input and output, PII removed. */
  input?: string;
  output?: string;
  ms?: number | null;
  verified?: boolean;
};

export type Timeline = {
  booking: {
    ref: string;
    status: string;
    source: string;
    service: string;
    staff: string;
    proName: string;
    proHandle: string;
    timezone: string;
    start: number;
    end: number;
    firstName: string | null;
    currency: string;
    priceCents: number;
    depositCents: number;
    feeCents: number;
    paidCents: number;
    refundedCents: number;
  };
  items: TimelineItem[];
  /** True when the page picked the latest demo booking itself (no ref or id in the URL). */
  latest: boolean;
};

export type TimelineResult = { found: true; timeline: Timeline } | { found: false; reason: "none" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9]{6}$/;

/** The latest web or MCP booking of the demo pro, or null. */
async function latestDemoBooking(db: Db): Promise<BookingDetail | null> {
  const { data: pro } = await db.from("pros").select("id").eq("handle", DEMO_HANDLE).maybeSingle().throwOnError();
  if (!pro) return null;
  const { data } = await db
    .from("bookings")
    .select("id")
    .eq("pro_id", pro.id)
    .in("source", ["mcp", "web", "whatsapp"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data ? getBooking(db, data.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------------------------

// Keys whose values are personal data or secrets: never shown on the public page.
const PRIVATE_KEY = /phone|e164|email|mail|payer|address|surname|last_?name|token|secret|password|wa_?id|^text$|^content$/i;

function short(value: Json | undefined, depth = 0): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 45)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (depth > 0) return `[${value.length}]`;
    const shown = value.slice(0, 3).map((v) => short(v, depth + 1));
    return `[${shown.join(", ")}${value.length > 3 ? `, +${value.length - 3}` : ""}]`;
  }
  if (depth > 0) return "{…}";
  return `{${summarize(value, depth + 1)}}`;
}

/** `pro_handle: aicha.braids · start: 2026-11-07T09:00…`, at most ~160 characters, private keys hidden. */
export function summarize(value: Json | null | undefined, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object" || Array.isArray(value)) return short(value, depth);
  const parts: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    parts.push(`${key}: ${PRIVATE_KEY.test(key) ? "•••" : short(v, depth)}`);
  }
  const text = parts.join(" · ");
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// ---------------------------------------------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------------------------------------------

export async function loadTimeline(selector: Selector): Promise<TimelineResult> {
  const db = serviceClient();
  const ref = selector.ref?.trim();
  const id = selector.b?.trim();
  let booking: BookingDetail | null;
  if (ref) booking = REF.test(ref) ? await getBookingByRef(db, ref) : null;
  else if (id) booking = UUID.test(id) ? await getBooking(db, id) : null;
  else booking = await latestDemoBooking(db);
  if (!booking) return { found: false, reason: ref || id ? "not_found" : "none" };

  const resourceIds = [
    ...booking.payments.flatMap((p) => [p.paypalOrderId, p.captureId]),
    ...booking.refunds.map((r) => r.paypalRefundId),
    ...booking.payouts.flatMap((p) => [p.payoutBatchId, p.payoutItemId]),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  const [events, paypal, pro] = await Promise.all([
    listAgentEvents(db, { bookingId: booking.id }, { limit: 300 }),
    resourceIds.length > 0
      ? db
          .from("paypal_events")
          .select("event_id, type, resource_id, verified, received_at")
          .in("resource_id", resourceIds)
          .order("received_at")
          .limit(100)
          .throwOnError()
          .then((r) => r.data)
      : Promise.resolve([]),
    db.from("pros").select("name, handle, timezone").eq("id", booking.proId).single().throwOnError().then((r) => r.data),
  ]);

  const items: TimelineItem[] = [];
  for (const e of events) {
    // Model turns carry the conversation text: only their timing is shown.
    const isModel = e.kind === "model";
    items.push({
      id: `a${e.id}`,
      // Logged when the call ends: placed at its start, so a tool call comes before what it caused.
      at: e.createdAt - (e.ms ?? 0),
      kind: e.kind === "error" ? "error" : e.kind === "paypal" ? "paypal" : "agent",
      title: e.name,
      ...(isModel ? {} : { input: summarize(e.input), output: summarize(e.output) }),
      ms: e.ms,
    });
  }
  for (const p of paypal) {
    items.push({
      id: `p${p.event_id}`,
      at: Date.parse(p.received_at),
      kind: "paypal",
      title: `Webhook ${p.type}`,
      input: p.resource_id ? `resource: ${p.resource_id}` : undefined,
      verified: p.verified,
    });
  }

  // Milestones from the booking's own rows.
  const amount = (cents: number) => formatMoney(cents, "en", booking.currency);
  const milestone = (key: string, at: number | null, title: string, detail?: string) => {
    if (at !== null) items.push({ id: `b${key}`, at, kind: "booking", title, ...(detail ? { output: detail } : {}) });
  };
  milestone("held", booking.createdAt, `Booking ${booking.ref} held`, `source: ${booking.source} · staff: ${booking.staff.name}`);
  for (const p of booking.payments) {
    milestone(`o${p.id}`, p.createdAt, `PayPal order created`, `order: ${p.paypalOrderId} · amount: ${amount(p.amountCents)}`);
    milestone(`c${p.id}`, p.capturedAt, `Deposit captured → booking confirmed`, `capture: ${p.captureId ?? "?"}`);
  }
  for (const r of booking.refunds) milestone(`r${r.id}`, r.createdAt, `Refund ${r.status}`, `amount: ${amount(r.amountCents)} · reason: ${r.reason}`);
  for (const p of booking.payouts) milestone(`y${p.id}`, p.createdAt, `Payout ${p.status}`, `amount: ${amount(p.amountCents)}`);
  milestone("cancelled", booking.cancelledAt, `Booking cancelled`, booking.cancelledBy ? `by: ${booking.cancelledBy}` : undefined);
  milestone("displaced", booking.displacedAt, `Displaced by a sick-day block`);
  if (booking.status === "expired") milestone("expired", booking.holdExpiresAt, `Hold expired`, "the deposit was not paid in time");

  items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  return {
    found: true,
    timeline: {
      booking: {
        ref: booking.ref,
        status: booking.status,
        source: booking.source,
        service: booking.service.name,
        staff: booking.staff.name,
        proName: pro.name,
        proHandle: pro.handle,
        timezone: pro.timezone,
        start: booking.start,
        end: booking.end,
        firstName: booking.client?.firstName ?? null,
        currency: booking.currency,
        priceCents: booking.priceCents,
        depositCents: booking.depositCents,
        feeCents: booking.feeCents,
        paidCents: booking.money.paidCents,
        refundedCents: booking.money.refundedCents,
      },
      items,
      latest: !ref && !id,
    },
  };
}
