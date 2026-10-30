// What the dashboard's server actions hand to the browser: plain, serialisable rows (epoch ms, cents).

export type Currency = "EUR" | "GBP";
export type BookingStatus = "held" | "confirmed" | "honoured" | "no_show" | "cancelled" | "expired";
export type BookingSource = "web" | "whatsapp" | "mcp" | "manual";

export type CalBooking = {
  id: string;
  ref: string;
  staffId: string;
  staffName: string;
  start: number;
  end: number;
  status: BookingStatus;
  holdExpiresAt: number | null;
  displacedAt: number | null;
  movedFrom: number | null;
  clientName: string | null;
  serviceName: string;
  priceCents: number;
  depositCents: number;
  feeCents: number;
  /** price − deposit, paid at the salon or by invoice. */
  balanceCents: number;
  balancePaid: boolean;
  currency: Currency;
  /** Two-letter tag of the language she books in: IT, FR, EN, ES, PT. */
  language: string;
  source: BookingSource;
  /** The deposit payment: none before PayPal. */
  paymentStatus: "none" | "created" | "approved" | "captured" | "refunded" | "denied";
  paidCents: number;
  refundStatus: "none" | "pending" | "succeeded" | "failed";
  refundedCents: number;
  payoutStatus: "pending" | "sent" | "succeeded" | "failed" | "unclaimed" | null;
  payoutCents: number | null;
  cancelledBy: "client" | "pro" | "system" | null;
  conversationId: string | null;
};

export type CalBlock = { id: string; staffId: string | null; start: number; end: number; label: string | null };

export type PendingActionRow = {
  id: string;
  kind: "refund" | "payout" | "invoice";
  summary: string;
  amountCents: number | null;
  currency: Currency | null;
  bookingId: string | null;
  createdAt: number;
};

export type StaffRow = { id: string; name: string; color: string | null };

/** Her opening hours on one day in minutes after midnight (her zone), breaks included; null: closed. */
export type OpenHours = { open: number; close: number; breaks: { from: number; to: number }[] } | null;

/** A booking a sick-day block displaced: the times the receptionist offered its client (event.booking_displaced). */
export type CascadeOffer = { at: number; starts: number[] };

/** The receptionist changed this booking on the client's answer (reschedule_booking / cancel_booking tool calls). */
export type AgentChange = { kind: "moved" | "cancelled"; at: number };

export type WeekData = {
  weekStart: number;
  weekEnd: number;
  bookings: CalBooking[];
  blocks: CalBlock[];
  pendingActions: PendingActionRow[];
  /** Booking id → start the pro proposed by dragging, until the client answers. */
  proposals: Record<string, number>;
  /** "yyyy-mm-dd" (her zone) → opening hours that day: the weekly schedule with day overrides applied. */
  hours: Record<string, OpenHours>;
  /** Displaced booking id → the alternative times the receptionist offered, until the client answers. */
  offers: Record<string, CascadeOffer>;
  /** Booking id → the last change the receptionist made on the client's answer (the ✦ badge). */
  agentChanges: Record<string, AgentChange>;
};

export type MoneyRow = {
  id: string;
  type: "payment" | "refund" | "payout";
  bookingId: string;
  ref: string | null;
  clientName: string | null;
  amountCents: number;
  currency: Currency;
  status: string;
  detail: string;
  at: number;
  /** PayPal's capture, refund or payout item id (a "SEED-" id is demo data). */
  paypalId: string | null;
};

export type MoneyTotals = { capturedCents: number; refundedCents: number; paidOutCents: number; pendingPayoutCents: number; feesCents: number };

export type MoneyData = {
  currency: Currency;
  rows: MoneyRow[];
  /** From the earnings service when it answered, else from the rows above. */
  totals: MoneyTotals;
  /** PayPal Reporting rows matching her bookings (sandbox lags by hours); null when unavailable. */
  paypal: { rows: number; lastRefreshed: string | null } | null;
  earningsError: string | null;
};

export type ProSummary = {
  id: string;
  name: string;
  handle: string;
  city: string | null;
  currency: Currency;
  timezone: string;
  /** False: payouts wait until she adds her PayPal e-mail. */
  hasPayoutEmail: boolean;
};

export type ChatLine = { id: string; role: "user" | "assistant"; text: string; at: number };

export type ActionResult = { ok: true; message?: string; detail?: string; link?: { href: string; label: string } } | { ok: false; error: string };

/** Where a dragged booking can be proposed: each valid start (epoch ms) with the staff free at it. */
export type DropTargets = { ok: true; starts: { start: number; staffIds: string[] }[] } | { ok: false; error: string };

/** A start a new booking could take (her shortest service fits), per staff: a tick on the calendar at rest. */
export type BookableTick = { start: number; staffId: string };

// ---------------------------------------------------------------------------------------------------------------
// Visual state: one per deposit situation (the calendar, the agenda list and the attention list agree).
// ---------------------------------------------------------------------------------------------------------------

export type Look = "held" | "confirmed" | "unpaid" | "displaced" | "cancelled" | "balance_due" | "done" | "no_show" | "expired";

export function lookOf(b: CalBooking): Look {
  switch (b.status) {
    case "held":
      return "held";
    case "confirmed":
      if (b.displacedAt !== null) return "displaced";
      return b.paymentStatus === "captured" ? "confirmed" : "unpaid";
    case "cancelled":
      return "cancelled";
    case "honoured":
      return b.balanceCents > 0 && !b.balancePaid ? "balance_due" : "done";
    case "no_show":
      return "no_show";
    default:
      return "expired";
  }
}

export function formatMoney(cents: number, currency: Currency): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** The chip under a booking: "Deposit paid", "Waiting for client", "Refunded €33"… (the hold countdown is added live). */
export function lookLabel(b: CalBooking): string {
  switch (lookOf(b)) {
    case "held":
      return "Held";
    case "confirmed":
      return "Deposit paid";
    case "unpaid":
      return "Confirmed";
    case "displaced":
      return "Waiting for client";
    case "cancelled":
      if (b.refundStatus === "succeeded") return `Refunded ${formatMoney(b.refundedCents, b.currency)}`;
      if (b.refundStatus === "pending") return "Refund pending";
      if (b.refundStatus === "failed") return "Refund failed";
      return "Cancelled";
    case "balance_due":
      return `Balance due ${formatMoney(b.balanceCents, b.currency)}`;
    case "done":
      return "Done";
    case "no_show":
      return "No-show";
    default:
      return "Expired";
  }
}

export const SOURCE_LABEL: Record<BookingSource, string> = { web: "Web chat", whatsapp: "WhatsApp", mcp: "AI agent (MCP)", manual: "Manual" };

/** What changed in a booking that the pro should see flash. */
export function bookingSignature(b: CalBooking): string {
  return [b.status, b.start, b.end, b.staffId, b.displacedAt ?? "", b.paymentStatus, b.refundStatus, b.payoutStatus ?? ""].join("|");
}

/**
 * Money that did not go through and needs her eye: a refund PayPal refused (failed) or has not taken yet (pending: the
 * daily sweeper retries it), a payout PayPal could not deliver (failed, unclaimed: no PayPal account on that e-mail),
 * or a payout waiting for her PayPal e-mail. Null when all is well.
 */
export function moneyIssue(b: CalBooking, hasPayoutEmail: boolean): string | null {
  if (b.refundStatus === "failed") return "Refund failed";
  if (b.refundStatus === "pending" && b.status !== "held") return "Refund pending";
  if (b.payoutStatus === "failed") return "Payout failed";
  if (b.payoutStatus === "unclaimed") return "Payout unclaimed: no PayPal account on your e-mail";
  if (b.payoutStatus === "pending" && !hasPayoutEmail) return "Payout waiting: add your PayPal e-mail";
  return null;
}

/**
 * What a booking moved in money, counted like the Money tab (captured and refunded payments, refunds not failed,
 * payouts sent or received), for the calendar's money columns by appointment day.
 */
export function bookingMoneyCents(b: CalBooking): { captured: number; refunded: number; paidOut: number } {
  const paidOut = b.payoutStatus === "succeeded" || b.payoutStatus === "sent" ? (b.payoutCents ?? 0) : 0;
  return { captured: b.paidCents, refunded: b.refundedCents, paidOut };
}
