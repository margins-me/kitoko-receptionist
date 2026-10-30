import "server-only";
import type { Locale } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import { createPendingAction, decidePendingAction, getBooking, getPendingAction, getPro, requestRefund, setPendingActionResult } from "@kitoko/db";
import type { BookingDetail, PendingAction, PendingActionKind } from "@kitoko/db";
import { cancelBooking, markDone } from "./booking";
import type { ServicesCtx } from "./ctx";
import { processRefunds, sendBalanceInvoice } from "./payments";
import { logEvent, moneyText, toJson } from "./util";

export type ActionPayload = {
  /** payout: what the pro marks. */
  outcome?: "honoured" | "no_show";
};

type Summary = (ref: string, amount: string) => string;
const SUMMARIES: Record<PendingActionKind, Record<Locale, Summary>> = {
  refund: {
    en: (ref, a) => `Refund ${a} to the client of ${ref}`,
    fr: (ref, a) => `Rembourser ${a} à la cliente de ${ref}`,
    it: (ref, a) => `Rimborsare ${a} alla cliente di ${ref}`,
    es: (ref, a) => `Reembolsar ${a} a la clienta de ${ref}`,
    pt: (ref, a) => `Reembolsar ${a} à cliente de ${ref}`,
  },
  payout: {
    en: (ref, a) => `Close ${ref} and pay ${a} out to your PayPal`,
    fr: (ref, a) => `Clôturer ${ref} et virer ${a} sur ton PayPal`,
    it: (ref, a) => `Chiudere ${ref} e versare ${a} sul tuo PayPal`,
    es: (ref, a) => `Cerrar ${ref} y pagarte ${a} en PayPal`,
    pt: (ref, a) => `Fechar ${ref} e transferir ${a} para o teu PayPal`,
  },
  invoice: {
    en: (ref, a) => `Send a PayPal invoice of ${a} for ${ref}`,
    fr: (ref, a) => `Envoyer une facture PayPal de ${a} pour ${ref}`,
    it: (ref, a) => `Inviare una fattura PayPal di ${a} per ${ref}`,
    es: (ref, a) => `Enviar una factura PayPal de ${a} por ${ref}`,
    pt: (ref, a) => `Enviar uma fatura PayPal de ${a} para ${ref}`,
  },
};

/** What is left to refund on a booking's captured deposit (deposit + fee − refunds). */
const refundable = (b: BookingDetail): number => Math.max(0, b.money.paidCents - b.money.refundedCents);

/** What a payout would send: the deposit, minus any refunded deposit part (never the booking fee). */
function payoutAmount(b: BookingDetail): number {
  if (b.money.payoutCents !== null) return b.money.payoutCents;
  const deposit = b.payments.find((p) => p.kind === "deposit" && (p.status === "captured" || p.status === "refunded"));
  if (!deposit) return 0;
  return Math.max(0, deposit.depositCents - b.money.refundedCents);
}

/**
 * A refund, payout or invoice the pro asked her assistant for: computes the amount from the booking's rows and stores
 * a pending action. Nothing moves until decideAction gets her button press.
 */
export async function requestAction(
  ctx: ServicesCtx,
  i: { proId: string; kind: PendingActionKind; bookingId: string; payload?: ActionPayload; conversationId?: string | null; locale?: Locale },
): Promise<Result<PendingAction, string>> {
  const [pro, booking] = await Promise.all([getPro(ctx.db, i.proId), getBooking(ctx.db, i.bookingId)]);
  if (!pro || !booking || booking.proId !== pro.id) return err("not_found");
  let amountCents: number;
  const payload: Record<string, unknown> = {};
  switch (i.kind) {
    case "refund":
      amountCents = refundable(booking);
      if (amountCents <= 0) return err("nothing_to_refund");
      payload.mode = booking.status === "confirmed" ? "cancel" : "remaining";
      break;
    case "payout": {
      if (!["confirmed", "honoured", "no_show"].includes(booking.status)) return err("not_markable");
      if (booking.money.payoutStatus && booking.money.payoutStatus !== "pending") return err("already_paid_out");
      const outcome = i.payload?.outcome ?? "honoured";
      if (outcome === "no_show" && booking.start > ctx.now().getTime()) return err("not_started");
      amountCents = payoutAmount(booking);
      if (amountCents <= 0) return err("nothing_to_pay_out");
      if (!pro.paypalEmail) return err("no_paypal_email");
      payload.outcome = outcome;
      break;
    }
    case "invoice":
      amountCents = booking.balanceCents;
      if (amountCents <= 0) return err("nothing_due");
      if (!booking.client?.email) return err("no_client_email");
      break;
  }
  const summary = SUMMARIES[i.kind][i.locale ?? pro.locale](booking.ref, moneyText(amountCents, i.locale ?? pro.locale, booking.currency));
  const action = await createPendingAction(ctx.db, {
    proId: pro.id,
    kind: i.kind,
    summary,
    conversationId: i.conversationId ?? null,
    bookingId: booking.id,
    amountCents,
    currency: booking.currency,
    payload: toJson(payload),
  });
  return ok(action);
}

export type Decision = { action: PendingAction; result: unknown };

/**
 * The pro's button press (dashboard, or a WhatsApp button reply from her number): flips the pending action once, then
 * moves the money. The only path from a pro's request to a refund, a payout or an invoice. Never called by a model.
 */
export async function decideAction(
  ctx: ServicesCtx,
  i: { actionId: string; decision: "confirmed" | "cancelled"; proId: string },
): Promise<Result<Decision, string>> {
  const before = await getPendingAction(ctx.db, i.actionId);
  if (!before || before.proId !== i.proId) return err("not_found");
  const decided = await decidePendingAction(ctx.db, i.actionId, i.decision);
  if (!decided.ok) return decided;
  const action = decided.value;
  await logEvent(ctx, { kind: "system", name: `action.${i.decision}`, proId: action.proId, bookingId: action.bookingId, conversationId: action.conversationId, input: { actionId: action.id, kind: action.kind } });
  if (i.decision === "cancelled") return ok({ action, result: null });

  let result: Result<unknown, string>;
  const bookingId = action.bookingId;
  if (!bookingId) {
    result = err("not_found");
  } else if (action.kind === "refund") {
    const booking = await getBooking(ctx.db, bookingId);
    if (booking?.status === "confirmed") {
      result = await cancelBooking(ctx, { bookingId, by: "pro", reason: "pro_refund" });
    } else {
      const deposit = booking?.payments.find((p) => p.kind === "deposit" && (p.status === "captured" || p.status === "refunded"));
      const amount = booking ? refundable(booking) : 0;
      if (!deposit || amount <= 0) {
        result = err("nothing_to_refund");
      } else {
        const queued = await requestRefund(ctx.db, { paymentId: deposit.id, amountCents: amount, reason: "pro_request" });
        result = queued.ok ? await processRefunds(ctx, { bookingId }) : queued;
      }
    }
  } else if (action.kind === "payout") {
    const outcome = (action.payload as { outcome?: unknown } | null)?.outcome === "no_show" ? "no_show" : "honoured";
    result = await markDone(ctx, { bookingId, outcome });
  } else {
    result = await sendBalanceInvoice(ctx, { bookingId, requestId: `invoice-${action.id}` });
  }
  const stored = result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
  await setPendingActionResult(ctx.db, action.id, toJson(stored));
  if (!result.ok) return err(result.error);
  return ok({ action: { ...action, result: toJson(stored) }, result: result.value });
}
