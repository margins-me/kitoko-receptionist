import "server-only";
import { markPaypalEventProcessed, payoutStatus, paypalCaptureDenied, recordPaypalEvent, refundFinished } from "@kitoko/db";
import type { Json } from "@kitoko/db";
import { parseEvent, verifyWebhook } from "@kitoko/paypal";
import type { PayPalEvent } from "@kitoko/paypal";
import type { ServicesCtx } from "./ctx";
import { capturePayment, payoutStatusOf } from "./payments";
import { logEvent } from "./util";

export type WebhookReply = { status: number; body: Record<string, unknown> };

type HeaderBag = Parameters<typeof verifyWebhook>[0]["headers"];

/**
 * One PayPal webhook delivery (POST /api/paypal/webhook): verified with verify-webhook-signature, stored once by event
 * id, then dispatched. Replies:
 *   400 invalid_signature  PayPal says the signature is wrong (or the headers are missing): never processed
 *   503 verification_unavailable  PayPal could not be asked: PayPal retries later
 *   200 duplicate          the event id was already processed (PayPal retries, duplicates)
 *   200 ok                 processed, or an event type nobody needs (ignored, recorded)
 *   500 processing_failed  dispatch threw: the event is forgotten so PayPal's retry processes it again
 * Every handler is idempotent (captures confirm once, refund and payout updates are by status), so a retry or an
 * out-of-order delivery (a refund before its capture) is safe.
 */
export async function handlePayPalWebhook(ctx: ServicesCtx, i: { headers: HeaderBag; body: string }): Promise<WebhookReply> {
  const verified = await verifyWebhook({ headers: i.headers, body: i.body }, ctx.paypal);
  // Every rejected delivery leaves a trace (no payload, no PII), so a misconfigured webhook is visible on /how-it-works.
  const raw = i.headers instanceof Headers ? i.headers.get("paypal-transmission-id") : i.headers["paypal-transmission-id"];
  const transmission = (Array.isArray(raw) ? raw[0] : raw) ?? null;
  if (!verified.ok) {
    console.error("[paypal/webhook] verification failed", verified.error);
    await logEvent(ctx, { kind: "error", name: "webhook.verification_unavailable", input: { transmission }, output: { error: verified.error.message } });
    return { status: 503, body: { error: "verification_unavailable" } };
  }
  if (!verified.value) {
    await logEvent(ctx, { kind: "error", name: "webhook.invalid_signature", input: { transmission, hasHeaders: Boolean(transmission) }, output: null });
    return { status: 400, body: { error: "invalid_signature" } };
  }

  const parsed = parseEvent(i.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const event = parsed.value;

  const fresh = await recordPaypalEvent(ctx.db, {
    eventId: event.eventId,
    type: event.eventType,
    resourceId: resourceIdOf(event),
    payload: JSON.parse(i.body) as Json,
    verified: true,
  });
  if (!fresh) return { status: 200, body: { ok: true, duplicate: true } };

  try {
    const ignored = await dispatch(ctx, event);
    await markPaypalEventProcessed(ctx.db, event.eventId);
    return { status: 200, body: { ok: true, ...(ignored ? { ignored: true } : {}) } };
  } catch (e) {
    console.error("[paypal/webhook] dispatch failed", event.eventType, e);
    await logEvent(ctx, { kind: "error", name: `webhook.${event.eventType}`, input: { eventId: event.eventId }, output: { error: e instanceof Error ? e.message : String(e) } });
    // Forget it: PayPal retries a non-2xx delivery, and the retry must not be taken for a duplicate.
    await ctx.db.from("paypal_events").delete().eq("event_id", event.eventId).is("processed_at", null);
    return { status: 500, body: { error: "processing_failed" } };
  }
}

function resourceIdOf(e: PayPalEvent): string | null {
  switch (e.kind) {
    case "order":
      return e.orderId;
    case "capture":
      return e.captureId;
    case "refund":
      return e.refundId;
    case "payout_item":
      return e.payoutItemId;
    case "payout_batch":
      return e.payoutBatchId;
    case "invoice_paid":
      return e.invoiceId;
    case "other":
      return e.resourceId;
  }
}

/** Runs the event. True when nothing needed doing (an event type or resource Kitoko does not track). */
async function dispatch(ctx: ServicesCtx, e: PayPalEvent): Promise<boolean> {
  await logEvent(ctx, { kind: "paypal", name: `webhook.${e.eventType}`, bookingId: "customId" in e ? e.customId : null, input: { eventId: e.eventId, kind: e.kind } });
  switch (e.kind) {
    case "order": {
      // The buyer approved on PayPal but never came back to the page (tab closed): capture here, so the booking still
      // confirms. Same idempotent capture as the return URL, so a buyer who does come back gets one confirmation.
      if (e.eventType !== "CHECKOUT.ORDER.APPROVED") return true;
      const r = await capturePayment(ctx, { orderId: e.orderId });
      if (!r.ok && r.error === "not_found") return true;
      if (!r.ok && r.error !== "declined") throw new Error(`capture: ${r.error}`);
      return false;
    }
    case "capture": {
      if (!e.orderId) return true;
      if (e.eventType === "PAYMENT.CAPTURE.COMPLETED") {
        const r = await capturePayment(ctx, { orderId: e.orderId });
        if (!r.ok && r.error === "not_found") return true;
        // declined: the buyer is asked to approve again on the page; nothing to retry here.
        if (!r.ok && r.error !== "declined") throw new Error(`capture: ${r.error}`);
        return false;
      }
      if (e.eventType === "PAYMENT.CAPTURE.DECLINED" || e.eventType === "PAYMENT.CAPTURE.DENIED") {
        // A capture PayPal held (PENDING) was refused in the end: the payment is denied and the hold lets go.
        const r = await paypalCaptureDenied(ctx.db, e.orderId);
        return !r.ok;
      }
      return true;
    }
    case "refund": {
      // Our refund row: by PayPal's refund id, else the pending one of that amount on the capture. A refund event can
      // come before our own call recorded PayPal's answer: the pending row matches, and refund_finished is idempotent.
      const { data: byId } = await ctx.db.from("refunds").select("id").eq("paypal_refund_id", e.refundId).maybeSingle();
      let refundId = byId?.id ?? null;
      if (!refundId && e.captureId) {
        const { data: payment } = await ctx.db.from("payments").select("id").eq("capture_id", e.captureId).maybeSingle();
        if (payment) {
          let q = ctx.db.from("refunds").select("id").eq("payment_id", payment.id).eq("status", "pending");
          if (e.amountCents !== null) q = q.eq("amount_cents", e.amountCents);
          const { data } = await q.order("created_at").limit(1).maybeSingle();
          refundId = data?.id ?? null;
        }
      }
      if (!refundId) return true;
      const s = e.status.toUpperCase();
      const status = s === "COMPLETED" ? "succeeded" : s === "FAILED" || s === "CANCELLED" ? "failed" : null;
      if (!status) return true;
      const { data: row } = await ctx.db.from("refunds").select("status").eq("id", refundId).single();
      // Already settled the other way (our call said failed, PayPal says completed, or the reverse): keep ours, log it.
      if (row && row.status !== "pending" && row.status !== status) {
        await logEvent(ctx, { kind: "error", name: "webhook.refund_mismatch", input: { refundId, ours: row.status, paypal: status } });
        return true;
      }
      const done = await refundFinished(ctx.db, { refundId, paypalRefundId: e.refundId, status });
      if (!done.ok) throw new Error(`refund: ${done.error}`);
      return false;
    }
    case "payout_item": {
      const status = payoutStatusOf(e.eventType.replace("PAYMENT.PAYOUTS-ITEM.", ""));
      if (!status) return true;
      if (e.senderItemId) {
        // The item id may not be stored yet (the batch read failed when the payout was sent).
        await ctx.db.from("payouts").update({ payout_item_id: e.payoutItemId }).eq("id", e.senderItemId).is("payout_item_id", null);
      }
      const r = await payoutStatus(ctx.db, { itemId: e.payoutItemId, status });
      return !r.ok;
    }
    default:
      return true;
  }
}
