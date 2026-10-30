import "server-only";
import { z } from "zod";
import { ok } from "@kitoko/booking/result";
import { listBookings, listProMoney, listStaff } from "@kitoko/db";
import type { BookingDetail, Conversation, PendingAction, PendingActionKind, Pro } from "@kitoko/db";
import { defineTool, toolError } from "../core/tools";
import type { Tool } from "../core/tools";
import { requestAction } from "../services/actions";
import { blockTime } from "../services/booking";
import type { Env, ServicesCtx } from "../services/ctx";
import { earnings, findProBooking } from "../services/payments";
import { iso, localLabel, moneyText, nowMs } from "../services/util";
import { describeBooking, localRange, pastRange } from "./describe";
import { paypalToolkitTools } from "./paypal-toolkit";

/** What a pro tool runs with. `actions` collects the pending actions created in this run (WhatsApp confirm buttons). */
export type ProToolCtx = {
  services: ServicesCtx;
  pro: Pro;
  conversation: Conversation;
  actions: PendingAction[];
};

const tool = defineTool<ProToolCtx>();

/** The dashboard is in English; on WhatsApp the pro reads her own language. Amounts, dates and summaries follow it. */
const lang = (c: ProToolCtx) => (c.conversation.channel === "whatsapp" ? c.pro.locale : "en");

const ERRORS: Record<string, string> = {
  not_found: "No booking of yours with that id or ref. Use list_bookings.",
  nothing_to_refund: "Nothing paid on this booking is left to refund.",
  nothing_to_pay_out: "There is no captured deposit to pay out on this booking.",
  already_paid_out: "This booking was already paid out.",
  not_markable: "Only confirmed (or already marked) bookings can be marked done or no-show.",
  not_started: "A no-show can only be marked once the appointment has started.",
  no_paypal_email: "Her PayPal e-mail for payouts is not set: she must add it in the dashboard settings.",
  nothing_due: "Nothing is left to pay on this booking (no balance).",
  no_client_email: "The client has no e-mail address on file, so PayPal cannot send her an invoice.",
  invalid_dates: "The dates are not valid: use YYYY-MM-DD (or YYYY-MM-DDTHH:MM local time).",
  range_too_long: "Block at most 31 days at a time.",
};
const fail = (code: string) => toolError(code, ERRORS[code]);

const bookingInput = z.string().min(1).describe("booking_id or the 6-character ref.");
const dates = {
  date_from: z.string().optional().describe("First day, YYYY-MM-DD (her time zone). Default: today."),
  date_to: z.string().optional().describe("Last day (inclusive), YYYY-MM-DD. Default: 6 days after date_from."),
};

const FILTERS = ["all", "unpaid", "held", "confirmed", "displaced", "cancelled", "done"] as const;

function keep(b: BookingDetail, filter: (typeof FILTERS)[number]): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unpaid":
      return b.status === "held" || (b.status === "confirmed" && b.money.paidCents === 0);
    case "held":
      return b.status === "held";
    case "confirmed":
      return b.status === "confirmed";
    case "displaced":
      return b.displacedAt !== null;
    case "cancelled":
      return b.status === "cancelled";
    case "done":
      return b.status === "honoured" || b.status === "no_show";
  }
}

/** The dashboard's confirm button for each kind (apps/web assistant.tsx CONFIRM_LABEL). */
const BUTTON_LABEL: Record<PendingActionKind, string> = { refund: "Confirm refund", payout: "Send payout", invoice: "Send invoice" };

async function pending(c: ProToolCtx, kind: PendingActionKind, booking: string, payload?: { outcome: "honoured" | "no_show" }) {
  const b = await findProBooking(c.services, c.pro.id, booking);
  if (!b) return fail("not_found");
  const action = await requestAction(c.services, { proId: c.pro.id, kind, bookingId: b.id, conversationId: c.conversation.id, locale: lang(c), ...(payload ? { payload } : {}) });
  if (!action.ok) return fail(action.error);
  c.actions.push(action.value);
  return ok({
    action_id: action.value.id,
    status: "waiting_for_her_confirmation",
    summary: action.value.summary,
    amount: action.value.amountCents === null ? null : moneyText(action.value.amountCents, lang(c), c.pro.currency),
    note: `Nothing has moved yet. She must tap ${c.conversation.channel === "whatsapp" ? "Confirm" : `"${BUTTON_LABEL[kind]}"`} under your message to do it. Name that button.`,
  });
}

const proToolList: Tool<z.ZodType, ProToolCtx>[] = [
  tool({
    name: "show_money",
    description:
      "Opens her Money tab with the ledger (this week's PayPal payments, refunds and payouts) filtered as asked: by type, status or client. Use it when she asks to see, list or show money rows (\"show me the refunds\", \"what did Giulia pay\"). It shows rows; it does not answer totals (use earnings) and moves nothing.",
    input: z.object({
      type: z.enum(["payment", "refund", "payout"]).nullable().optional().describe("Only this kind of row. Omit for all."),
      status: z.string().nullable().optional().describe("Only this status: captured, refunded, pending, sent, succeeded, failed, unclaimed."),
      client: z.string().nullable().optional().describe("Only rows of this client (first name)."),
    }),
    run: async (input, c) => {
      if (c.conversation.channel !== "web") return ok({ shown: false, note: "The ledger is on her dashboard, not here. Describe the rows from list_bookings or earnings instead." });
      const filter = { type: input.type ?? null, status: input.status ?? null, client: input.client ?? null };
      return ok({ shown: true, filter, note: "Her Money tab is now open, filtered. Say so in one line; do not list the rows yourself." });
    },
  }),
  tool({
    name: "list_bookings",
    description: "Her bookings between two dates with client, time, status and money. filter: all, unpaid (held or not paid), held, confirmed, displaced (by a block), cancelled, done.",
    input: z.object({ ...dates, filter: z.enum(FILTERS).optional() }),
    run: async (input, c) => {
      const range = localRange(c.pro.timezone, nowMs(c.services), input.date_from, input.date_to);
      if (!range || range.to - range.from > 62 * 86_400_000) return fail("invalid_dates");
      const statuses = input.filter === "held" || input.filter === "unpaid" ? { statuses: ["held" as const, "confirmed" as const] } : {};
      const all = await listBookings(c.services.db, c.pro.id, range.from, range.to, statuses);
      const list = all.filter((b) => keep(b, input.filter ?? "all"));
      return ok({ timezone: c.pro.timezone, count: list.length, bookings: list.map((b) => describeBooking(b, c.pro, lang(c))) });
    },
  }),

  tool({
    name: "refund_deposit",
    description:
      "Prepares a full refund of what the client paid on a booking (a confirmed booking is cancelled by the pro: deposit and booking fee refunded). Creates a pending action: the money moves only when she taps Confirm.",
    input: z.object({ booking: bookingInput }),
    run: (input, c) => pending(c, "refund", input.booking),
  }),

  tool({
    name: "mark_done",
    description:
      "Prepares marking a booking done (honoured) or no-show and paying the deposit out to her PayPal (PayPal Payouts). Creates a pending action: nothing happens until she taps Confirm.",
    input: z.object({ booking: bookingInput, outcome: z.enum(["honoured", "no_show"]) }),
    run: (input, c) => pending(c, "payout", input.booking, { outcome: input.outcome }),
  }),

  tool({
    name: "send_invoice",
    description: "Prepares a PayPal invoice for a booking's balance (price minus deposit) to the client's e-mail. Creates a pending action: it is sent only when she taps Confirm.",
    input: z.object({ booking: bookingInput }),
    run: (input, c) => pending(c, "invoice", input.booking),
  }),

  tool({
    name: "payout_status",
    description: "Her payouts (deposits paid out to her PayPal) for the appointments between two dates (default: the last 30 days), with their status.",
    input: z.object(dates),
    run: async (input, c) => {
      const range = pastRange(c.pro.timezone, nowMs(c.services), input.date_from, input.date_to);
      if (!range) return fail("invalid_dates");
      const money = await listProMoney(c.services.db, c.pro.id, range);
      return ok({
        payouts: money.payouts.map((p) => ({
          booking_id: p.bookingId,
          amount: moneyText(p.amountCents, lang(c), p.currency),
          reason: p.reason,
          status: p.status,
          created: localLabel(p.createdAt, c.pro.timezone, lang(c)),
        })),
      });
    },
  }),

  tool({
    name: "earnings",
    description:
      "Her money for the appointments between two dates (default: the last 30 days), whenever the deposits were paid: deposits captured, refunded, paid out, waiting to be paid out, booking fees, from Kitoko's records. For \"this week\" pass this week's dates. PayPal Reporting rows come as a separate, best-effort part (sandbox reporting lags by hours).",
    input: z.object(dates),
    run: async (input, c) => {
      const range = pastRange(c.pro.timezone, nowMs(c.services), input.date_from, input.date_to);
      if (!range) return fail("invalid_dates");
      const e = await earnings(c.services, { proId: c.pro.id, from: range.from, to: range.to });
      if (!e.ok) return fail(e.error);
      const m = (cents: number) => moneyText(cents, lang(c), e.value.currency);
      return ok({
        appointments_from: iso(range.from),
        appointments_to: iso(range.to),
        bookings_paid: e.value.bookings,
        captured: m(e.value.capturedCents),
        refunded: m(e.value.refundedCents),
        paid_out: m(e.value.paidOutCents),
        waiting_payout: m(e.value.pendingPayoutCents),
        booking_fees_kept_by_kitoko: m(e.value.feesCents),
        figures_source: "Kitoko's own records of these appointments (they are the totals to report).",
        paypal_reporting_best_effort: e.value.paypal
          ? {
              rows: e.value.paypal.rows.length,
              last_refreshed: e.value.paypal.lastRefreshed,
              transactions: e.value.paypal.rows.slice(0, 20),
              note: "PayPal's own transaction list, a separate line: sandbox reporting lags by hours and never includes the seeded demo payments.",
            }
          : "PayPal Reporting did not answer (it lags by hours in sandbox); the figures above are Kitoko's own.",
      });
    },
  }),

  tool({
    name: "block_time",
    description:
      "Blocks time in her calendar right away (sick day, break, holiday). Confirmed bookings in it are displaced and each client is messaged automatically with three free times or a full refund; the client's choice is carried out at once (a move, or the refund through PayPal), without her confirmation. Times are YYYY-MM-DDTHH:MM in her time zone (a whole day: 00:00 to the next day 00:00).",
    input: z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      staff_id: z.string().optional().describe("Only this staff member; omit to block the whole business."),
      label: z.string().min(1).max(80).describe("Why, in a few words (shown in her calendar)."),
    }),
    run: async (input, c) => {
      if (input.staff_id) {
        const staff = await listStaff(c.services.db, c.pro.id);
        if (!staff.some((s) => s.id === input.staff_id)) return toolError("unknown_staff", `Staff ids: ${staff.map((s) => `${s.id} (${s.name})`).join(", ")}`);
      }
      const r = await blockTime(c.services, { proId: c.pro.id, staffId: input.staff_id ?? null, from: input.from, to: input.to, label: input.label });
      if (!r.ok) return fail(r.error);
      const displaced = await Promise.all(r.value.displaced.map((id) => findProBooking(c.services, c.pro.id, id)));
      return ok({
        blocked: true,
        displaced: displaced.flatMap((b) =>
          b ? [{ ref: b.ref, client: b.client?.firstName ?? null, service: b.service.name, local: localLabel(b.start, c.pro.timezone, lang(c)), client_contacted: b.conversationId !== null }] : [],
        ),
        note:
          "Each displaced client with a conversation got a message with three free times or a full refund (booking fee included). The clients decide, nothing is waiting for her: a client who picks a time is moved there right away (deposit carried over); a client who prefers the refund gets it automatically through PayPal, with no Confirm button for her. Tell her exactly that.",
      });
    },
  }),
];

/** The pro assistant's tools, plus the PayPal Agent Toolkit read tools when sandbox credentials are set. */
export function buildProTools(env: Env): Tool<z.ZodType, ProToolCtx>[] {
  return [...proToolList, ...paypalToolkitTools<ProToolCtx>(env)];
}

export const PRO_TOOL_NAMES = proToolList.map((t) => t.name);
