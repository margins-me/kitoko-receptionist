import "server-only";
import type { Currency, Locale } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import {
  BOOKING_COLUMNS,
  confirmBooking,
  getBooking,
  getPaymentByOrderId,
  getPro,
  listPendingPayouts,
  listPendingRefunds,
  listProMoney,
  paypalCaptureCompleted,
  paypalCaptureDeclined,
  paypalPrepare,
  payoutSent,
  payoutStatus,
  refreshHoldOnOpen,
  refundFinished,
  toBookingDetail,
} from "@kitoko/db";
import type { BookingDetail, CaptureOutcome, Json, PayoutStatus } from "@kitoko/db";
import { captureOrder, createAndSendInvoice, createOrder, createPayout, getOrder, listTransactions, refundCapture } from "@kitoko/paypal";
import type { TransactionRow } from "@kitoko/paypal";
import { notifyConversation } from "./conversation";
import type { ServicesCtx } from "./ctx";
import { iso, localLabel, logEvent, moneyText, nowMs } from "./util";

// ---------------------------------------------------------------------------------------------------------------
// Deposit link
// ---------------------------------------------------------------------------------------------------------------

/** "/pay/{id}" for English, "/fr/pay/{id}" otherwise (next-intl, localePrefix as-needed). */
export const payPath = (bookingId: string, locale: Locale): string => `${locale === "en" ? "" : `/${locale}`}/pay/${bookingId}`;

export type DepositLink = {
  /** Our deposit page: summary, PayPal buttons, live status. The link to send to the client. */
  payUrl: string;
  /** PayPal's approval page (payer-action link); null when nothing is due. */
  approveUrl: string | null;
  orderId: string | null;
  /** deposit + booking fee, from the booking row. */
  amountCents: number;
  currency: Currency;
  /** True when nothing was due online and the booking was confirmed directly. */
  confirmed: boolean;
};

const E164 = /^\+[1-9]\d{6,14}$/;

/** A phone the client gave, in E.164 ("+39 333 123 4567", "0039…" → "+393331234567"), else null. */
export function asE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  return E164.test(compact) ? compact : null;
}

const whatsappPhone = (conv: { channel: string; external_id: string }): string | null =>
  conv.channel === "whatsapp" ? asE164(`+${conv.external_id.replace(/^\+/, "")}`) : null;

/**
 * Records who the client is before payment (first name, phone, e-mail) as the conversation's client, so the capture
 * (paypal_capture_completed reads the conversation's client) confirms the booking with her details instead of the
 * PayPal payer's. A phone already on file for this pro is that client, as upsert_client matches it at confirmation.
 * Without a first name, only an existing client is updated.
 */
async function rememberClient(
  ctx: ServicesCtx,
  booking: BookingDetail,
  who: { firstName?: string | undefined; phone?: string | undefined; email?: string | undefined },
): Promise<string | null> {
  const firstName = who.firstName?.trim().slice(0, 80) || null;
  if (!booking.conversationId) return null;
  const { data: conv } = await ctx.db.from("conversations").select("client_id, channel, external_id").eq("id", booking.conversationId).maybeSingle();
  if (!conv) return null;
  const given = asE164(who.phone);
  const phone = given ?? whatsappPhone(conv);
  const email = who.email?.trim() || null;
  let clientId = conv.client_id;
  if (phone) {
    const { data: owner } = await ctx.db.from("clients").select("id").eq("pro_id", booking.proId).eq("phone_e164", phone).maybeSingle();
    if (owner) clientId = owner.id;
  }
  if (clientId) {
    // A phone she typed replaces the one on file; the WhatsApp number only fills a missing one (it is the owner's).
    const patch = { ...(firstName ? { first_name: firstName } : {}), ...(given ? { phone_e164: given } : {}), ...(email ? { email } : {}) };
    if (Object.keys(patch).length) await ctx.db.from("clients").update(patch).eq("id", clientId);
  } else if (firstName) {
    const { data: created } = await ctx.db
      .from("clients")
      .insert({ pro_id: booking.proId, first_name: firstName, phone_e164: phone, email, locale: booking.locale })
      .select("id")
      .single();
    clientId = created?.id ?? null;
  }
  if (clientId && clientId !== conv.client_id) await ctx.db.from("conversations").update({ client_id: clientId }).eq("id", booking.conversationId);
  return clientId;
}

export type ClientDetails = { firstName: string | null; phone: string | null };

/** Who the booking is for, as far as we know: its client once confirmed, else its conversation's (or WhatsApp number). */
export async function bookingClient(ctx: ServicesCtx, booking: BookingDetail): Promise<ClientDetails> {
  if (booking.client) return { firstName: booking.client.firstName, phone: booking.client.phoneE164 };
  if (!booking.conversationId) return { firstName: null, phone: null };
  const { data } = await ctx.db
    .from("conversations")
    .select("channel, external_id, clients (first_name, phone_e164)")
    .eq("id", booking.conversationId)
    .maybeSingle();
  if (!data) return { firstName: null, phone: null };
  const client = (Array.isArray(data.clients) ? data.clients[0] : data.clients) as { first_name: string; phone_e164: string | null } | null | undefined;
  return { firstName: client?.first_name ?? null, phone: client?.phone_e164 ?? whatsappPhone(data) };
}

/**
 * The deposit page's "Your details": the client's first name (required) and mobile (optional, E.164), kept on the
 * booking's conversation so the capture confirms the booking with them. Only while the booking waits for payment.
 */
export async function saveClientDetails(
  ctx: ServicesCtx,
  i: { bookingId: string; firstName: string; phone?: string | null },
): Promise<Result<ClientDetails, "not_found" | "not_payable" | "invalid_name" | "invalid_phone">> {
  const firstName = i.firstName.trim();
  if (firstName.length < 1 || firstName.length > 80) return err("invalid_name");
  const phone = i.phone ? asE164(i.phone) : null;
  if (i.phone && !phone) return err("invalid_phone");
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking || !booking.conversationId) return err("not_found");
  if (booking.status !== "held" && booking.status !== "expired") return err("not_payable");
  const clientId = await rememberClient(ctx, booking, { firstName, ...(phone ? { phone } : {}) });
  if (!clientId) return err("not_found");
  await logEvent(ctx, {
    kind: "system",
    name: "client_details",
    proId: booking.proId,
    conversationId: booking.conversationId,
    bookingId: booking.id,
    input: { phone: phone !== null },
  });
  return ok({ firstName, phone });
}

/**
 * The deposit page was opened: the first time, a held booking's hold runs at least 15 more minutes from now (never
 * shortened), so a client who opens the link late still has time to pay. Later opens change nothing. Returns the
 * hold's end, null when the booking is not held.
 */
export async function openDepositPage(ctx: ServicesCtx, i: { bookingId: string }): Promise<Result<number | null, string>> {
  const r = await refreshHoldOnOpen(ctx.db, i.bookingId);
  if (!r.ok) return r;
  return ok(r.value);
}

/**
 * The PayPal order for a held booking's deposit and booking fee (amounts from the booking row), recorded with
 * paypal_prepare. Reuses the booking's open order when PayPal still offers its approval link. Nothing due: the
 * booking is confirmed directly.
 */
export async function createDepositLink(
  ctx: ServicesCtx,
  i: { bookingId: string; firstName?: string; phone?: string; email?: string },
): Promise<Result<DepositLink, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  if (booking.status === "confirmed" || booking.status === "honoured" || booking.status === "no_show") return err("already_confirmed");
  if (booking.status === "cancelled") return err("not_payable");
  if (booking.status === "expired" && (booking.holdExpiresAt ?? 0) < nowMs(ctx) - 60 * 60_000) return err("hold_expired");
  await rememberClient(ctx, booking, { firstName: i.firstName, phone: i.phone, email: i.email });

  const payUrl = `${ctx.siteUrl}${payPath(booking.id, booking.locale)}`;
  const amountCents = booking.depositCents + booking.feeCents;
  if (amountCents === 0) {
    const client = booking.conversationId
      ? (await ctx.db.from("conversations").select("clients (first_name, phone_e164, email)").eq("id", booking.conversationId).maybeSingle()).data
      : null;
    const known = client?.clients as { first_name: string; phone_e164: string | null; email: string | null } | null | undefined;
    const confirmed = await confirmBooking(ctx.db, {
      bookingId: booking.id,
      firstName: i.firstName?.trim() || known?.first_name || "Client",
      phoneE164: asE164(i.phone) ?? known?.phone_e164 ?? null,
      email: i.email ?? known?.email ?? null,
    });
    if (!confirmed.ok) return confirmed;
    return ok({ payUrl, approveUrl: null, orderId: null, amountCents: 0, currency: booking.currency, confirmed: true });
  }

  const open = booking.payments.filter((p) => p.kind === "deposit" && p.status === "created").sort((a, b) => b.createdAt - a.createdAt)[0];
  if (open) {
    const order = await getOrder(open.paypalOrderId, ctx.paypal);
    if (order.ok && order.value.approveUrl && (order.value.status === "CREATED" || order.value.status === "PAYER_ACTION_REQUIRED")) {
      return ok({ payUrl, approveUrl: order.value.approveUrl, orderId: open.paypalOrderId, amountCents, currency: booking.currency, confirmed: false });
    }
  }

  const attempt = booking.payments.filter((p) => p.kind === "deposit").length + 1;
  const pro = await getPro(ctx.db, booking.proId);
  const started = performance.now();
  const order = await createOrder(
    {
      bookingId: booking.id,
      ref: booking.ref,
      description: `${booking.service.name}, ${pro?.name ?? "Kitoko"}, ${localLabel(booking.start, pro?.timezone ?? "UTC", booking.locale)}`,
      currency: booking.currency,
      depositCents: booking.depositCents,
      feeCents: booking.feeCents,
      returnUrl: `${payUrl}/return`,
      cancelUrl: `${payUrl}?cancelled=1`,
      locale: booking.locale,
      requestId: `deposit-${booking.id}-${attempt}`,
    },
    ctx.paypal,
  );
  await logEvent(ctx, {
    kind: "paypal",
    name: "orders.create",
    bookingId: booking.id,
    conversationId: booking.conversationId,
    input: { amountCents, currency: booking.currency, attempt },
    output: order.ok ? { orderId: order.value.orderId, status: order.value.status } : { error: order.error.code, issue: order.error.issue, debugId: order.error.debugId },
    ms: performance.now() - started,
  });
  if (!order.ok) return err(order.error.retryable ? "paypal_unavailable" : "paypal_error");
  const prepared = await paypalPrepare(ctx.db, booking.id, order.value.orderId);
  if (!prepared.ok) return prepared;
  return ok({ payUrl, approveUrl: order.value.approveUrl, orderId: order.value.orderId, amountCents, currency: booking.currency, confirmed: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------------------------

export type CaptureResult = {
  bookingId: string;
  /** confirmed (first time), already_captured (seen before), pending (PayPal holds the funds), slot_lost, duplicate. */
  outcome: CaptureOutcome | "pending";
};

/**
 * Captures an approved order and confirms its booking. Idempotent: the return page and the webhook backstop share
 * PayPal-Request-Id `capture-{orderId}` and paypal_capture_completed only confirms once. On the first confirmation
 * the client agent writes the confirmation on her channel; on a lost slot the full refund runs right away.
 */
export async function capturePayment(ctx: ServicesCtx, i: { orderId: string }): Promise<Result<CaptureResult, string>> {
  const payment = await getPaymentByOrderId(ctx.db, i.orderId);
  if (!payment) return err("not_found");
  if (payment.status === "captured" || payment.status === "refunded") return ok({ bookingId: payment.bookingId, outcome: "already_captured" });
  if (payment.status === "denied") return err("declined");

  // After n declined captures the buyer approved again: a new PayPal-Request-Id, else PayPal replays the decline.
  const { data: attempt } = await ctx.db.from("payments").select("capture_declines").eq("id", payment.id).maybeSingle();
  const declines = attempt?.capture_declines ?? 0;
  const requestId = declines > 0 ? `capture-${i.orderId}-${declines}` : `capture-${i.orderId}`;

  const started = performance.now();
  const captured = await captureOrder({ orderId: i.orderId, requestId }, ctx.paypal);
  await logEvent(ctx, {
    kind: "paypal",
    name: "orders.capture",
    bookingId: payment.bookingId,
    input: { orderId: i.orderId, requestId },
    output: captured.ok
      ? { status: captured.value.status, captureId: captured.value.captureId, amountCents: captured.value.amountCents, alreadyCaptured: captured.value.alreadyCaptured }
      : { error: captured.error.code, issue: captured.error.issue, debugId: captured.error.debugId },
    ms: performance.now() - started,
  });
  if (!captured.ok) {
    const e = captured.error;
    if (e.code === "declined") {
      // The booking stays held: the buyer can approve again with another funding source until the hold runs out.
      await paypalCaptureDeclined(ctx.db, i.orderId);
      return err("declined");
    }
    if (e.issue === "ORDER_NOT_APPROVED") return err("not_approved");
    return err(e.retryable ? "paypal_unavailable" : "paypal_error");
  }
  const c = captured.value;
  if (c.status === "PENDING") return ok({ bookingId: payment.bookingId, outcome: "pending" });

  const [given] = (c.payer.name ?? "").split(/\s+/);
  const payer: Json = {
    ...(given ? { name: { given_name: given } } : {}),
    ...(c.payer.email ? { email_address: c.payer.email } : {}),
    ...(c.payer.payerId ? { payer_id: c.payer.payerId } : {}),
  };
  const done = await paypalCaptureCompleted(ctx.db, { orderId: i.orderId, captureId: c.captureId, amountCents: c.amountCents, currency: c.currency, payer });
  if (!done.ok) return done;
  const { bookingId, outcome } = done.value;

  if (outcome === "confirmed") {
    const booking = await getBooking(ctx.db, bookingId);
    if (booking?.conversationId) {
      const conversationId = booking.conversationId;
      const data = await capturedEventData(ctx, booking);
      await ctx.defer(() => notifyConversation(ctx, { conversationId, event: "payment_captured", data }));
    }
  } else if (outcome === "slot_lost" || outcome === "duplicate") {
    await processRefunds(ctx, { bookingId });
    const booking = await getBooking(ctx.db, bookingId);
    if (booking?.conversationId && outcome === "slot_lost") {
      const conversationId = booking.conversationId;
      const locale = booking.client?.locale ?? booking.locale;
      const data = {
        booking_ref: booking.ref,
        service: booking.service.name,
        start_local: localLabel(booking.start, (await getPro(ctx.db, booking.proId))?.timezone ?? "UTC", locale),
        what_happened: "The time was taken before the payment went through. The booking is not confirmed and everything paid is refunded in full.",
        refunded: moneyText(c.amountCents, locale, c.currency),
      };
      await ctx.defer(() => notifyConversation(ctx, { conversationId, event: "slot_lost", data }));
    }
  }
  return ok({ bookingId, outcome });
}

async function capturedEventData(ctx: ServicesCtx, booking: BookingDetail) {
  const pro = await getPro(ctx.db, booking.proId);
  const locale = booking.client?.locale ?? booking.locale;
  const tz = pro?.timezone ?? "UTC";
  return {
    booking_id: booking.id,
    booking_ref: booking.ref,
    service: booking.service.name,
    with: booking.staff.name,
    start: iso(booking.start),
    start_local: localLabel(booking.start, tz, locale),
    paid_now: moneyText(booking.money.paidCents, locale, booking.currency),
    deposit: moneyText(booking.depositCents, locale, booking.currency),
    booking_fee: moneyText(booking.feeCents, locale, booking.currency),
    balance_at_salon: moneyText(booking.balanceCents, locale, booking.currency),
    area: pro?.areaLabel ?? pro?.city ?? null,
    client_first_name: booking.client?.firstName ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Refunds and payouts (also run by the cron sweeper)
// ---------------------------------------------------------------------------------------------------------------

export type RefundRun = { refundId: string; bookingId: string; amountCents: number; status: "succeeded" | "pending" | "failed" | "skipped" };

/**
 * The backstop for a lost return and a lost webhook: deposit orders still `created` after 10 minutes (and less than a
 * day old) are asked for at PayPal, and the approved ones captured. Returns the order ids it captured or tried.
 */
export async function captureApprovedOrders(ctx: ServicesCtx): Promise<Result<{ orderId: string; result: string }[], string>> {
  const now = ctx.now().getTime();
  const { data, error } = await ctx.db
    .from("payments")
    .select("paypal_order_id")
    .eq("status", "created")
    .not("paypal_order_id", "is", null)
    .lt("created_at", new Date(now - 10 * 60_000).toISOString())
    .gt("created_at", new Date(now - 24 * 3_600_000).toISOString())
    .limit(50);
  if (error) return err(error.message);
  const out: { orderId: string; result: string }[] = [];
  for (const { paypal_order_id: orderId } of data) {
    if (!orderId || orderId.startsWith("SEED-")) continue;
    const order = await getOrder(orderId, ctx.paypal);
    if (!order.ok || order.value.status !== "APPROVED") continue;
    const captured = await capturePayment(ctx, { orderId });
    out.push({ orderId, result: captured.ok ? captured.value.outcome : captured.error });
  }
  return ok(out);
}

/** Sends pending refunds to PayPal (PayPal-Request-Id = refund row id) and records the outcome. */
export async function processRefunds(ctx: ServicesCtx, i: { bookingId?: string } = {}): Promise<Result<RefundRun[], string>> {
  const jobs = await listPendingRefunds(ctx.db, i.bookingId ? { bookingId: i.bookingId } : {});
  const runs: RefundRun[] = [];
  for (const job of jobs) {
    const base = { refundId: job.id, bookingId: job.bookingId, amountCents: job.amountCents };
    if (!job.captureId) {
      runs.push({ ...base, status: "skipped" });
      continue;
    }
    const started = performance.now();
    const r = await refundCapture(
      { captureId: job.captureId, amountCents: job.amountCents, currency: job.currency, reason: `Kitoko booking refund (${job.reason})`, requestId: job.id },
      ctx.paypal,
    );
    await logEvent(ctx, {
      kind: "paypal",
      name: "captures.refund",
      bookingId: job.bookingId,
      input: { captureId: job.captureId, amountCents: job.amountCents, reason: job.reason },
      output: r.ok ? { refundId: r.value.refundId, status: r.value.status } : { error: r.error.code, issue: r.error.issue, debugId: r.error.debugId },
      ms: performance.now() - started,
    });
    let status: RefundRun["status"];
    if (r.ok && r.value.status === "COMPLETED") {
      await refundFinished(ctx.db, { refundId: job.id, paypalRefundId: r.value.refundId, status: "succeeded" });
      status = "succeeded";
    } else if (r.ok && r.value.status === "PENDING") {
      await ctx.db.from("refunds").update({ paypal_refund_id: r.value.refundId }).eq("id", job.id);
      status = "pending";
    } else if (!r.ok && r.error.retryable) {
      status = "pending";
    } else {
      await refundFinished(ctx.db, { refundId: job.id, ...(r.ok ? { paypalRefundId: r.value.refundId } : {}), status: "failed" });
      status = "failed";
    }
    runs.push({ ...base, status });
  }
  return ok(runs);
}

/** PayPal item status → payouts.status (null: still in flight). */
export function payoutStatusOf(status: string): PayoutStatus | null {
  const s = status.toUpperCase();
  if (s === "SUCCESS" || s === "SUCCEEDED") return "succeeded";
  if (s === "UNCLAIMED") return "unclaimed";
  if (["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"].includes(s)) return "failed";
  return null;
}

export type PayoutRun = { payoutId: string; bookingId: string; amountCents: number; status: "sent" | "succeeded" | "failed" | "unclaimed" | "pending" | "no_paypal_email" };

/** Sends pending payouts to the pro's PayPal e-mail with the Payouts API (sender_batch_id = payout row id). */
export async function processPayouts(ctx: ServicesCtx, i: { bookingId?: string } = {}): Promise<Result<PayoutRun[], string>> {
  const jobs = await listPendingPayouts(ctx.db, i.bookingId ? { bookingId: i.bookingId } : {});
  const runs: PayoutRun[] = [];
  for (const job of jobs) {
    const base = { payoutId: job.id, bookingId: job.bookingId, amountCents: job.amountCents };
    if (!job.paypalEmail) {
      runs.push({ ...base, status: "no_paypal_email" });
      continue;
    }
    if (job.amountCents <= 0) continue;
    const started = performance.now();
    const r = await createPayout(
      {
        senderBatchId: job.id,
        items: [{ receiver: job.paypalEmail, amountCents: job.amountCents, currency: job.currency, note: `Kitoko payout (${job.reason})`, senderItemId: job.id }],
      },
      ctx.paypal,
    );
    await logEvent(ctx, {
      kind: "paypal",
      name: "payouts.create",
      bookingId: job.bookingId,
      input: { amountCents: job.amountCents, currency: job.currency, reason: job.reason },
      output: r.ok ? { batchId: r.value.payoutBatchId, status: r.value.status, items: r.value.items } : { error: r.error.code, issue: r.error.issue, debugId: r.error.debugId },
      ms: performance.now() - started,
    });
    if (!r.ok) {
      runs.push({ ...base, status: "pending" });
      continue;
    }
    const item = r.value.items[0];
    if (item?.payoutItemId) {
      await payoutSent(ctx.db, { payoutId: job.id, batchId: r.value.payoutBatchId, itemId: item.payoutItemId });
    } else {
      // The item id comes later (webhook or batch read): payout_item_id is unique, so never store a placeholder.
      await ctx.db.rpc("payout_sent", { p_payout_id: job.id, p_batch_id: r.value.payoutBatchId, p_item_id: null as unknown as string }).throwOnError();
    }
    const final = item?.payoutItemId ? payoutStatusOf(item.status) : null;
    if (final && item?.payoutItemId) await payoutStatus(ctx.db, { itemId: item.payoutItemId, status: final });
    runs.push({ ...base, status: final === "succeeded" || final === "failed" || final === "unclaimed" ? final : "sent" });
  }
  return ok(runs);
}

// ---------------------------------------------------------------------------------------------------------------
// Balance invoice
// ---------------------------------------------------------------------------------------------------------------

export type SentInvoiceResult = { bookingId: string; invoiceId: string; status: string; payerViewUrl: string | null; amountCents: number; currency: Currency };

/** A PayPal invoice for the balance (price − deposit) to the client's e-mail. */
export async function sendBalanceInvoice(ctx: ServicesCtx, i: { bookingId: string; requestId?: string }): Promise<Result<SentInvoiceResult, string>> {
  const booking = await getBooking(ctx.db, i.bookingId);
  if (!booking) return err("not_found");
  if (!["confirmed", "honoured"].includes(booking.status)) return err("not_invoiceable");
  if (booking.balanceCents <= 0) return err("nothing_due");
  const email = booking.client?.email;
  if (!email) return err("no_client_email");
  const started = performance.now();
  const invoicer = await getPro(ctx.db, booking.proId);
  const r = await createAndSendInvoice(
    {
      ...(invoicer ? { invoicerBusinessName: `${invoicer.name} · via Kitoko` } : {}),
      recipientEmail: email,
      recipientName: booking.client?.firstName ?? "Client",
      items: [{ name: `${booking.service.name} (balance)`, amountCents: booking.balanceCents }],
      currency: booking.currency,
      note: `Balance for booking ${booking.ref}.`,
      reference: booking.ref,
      requestId: i.requestId ?? `invoice-${booking.id}`,
    },
    ctx.paypal,
  );
  await logEvent(ctx, {
    kind: "paypal",
    name: "invoices.send",
    bookingId: booking.id,
    input: { amountCents: booking.balanceCents, currency: booking.currency },
    output: r.ok ? r.value : { error: r.error.code, issue: r.error.issue, debugId: r.error.debugId },
    ms: performance.now() - started,
  });
  if (!r.ok) return err(r.error.retryable ? "paypal_unavailable" : "paypal_error");
  return ok({ bookingId: booking.id, ...r.value, amountCents: booking.balanceCents, currency: booking.currency });
}

// ---------------------------------------------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------------------------------------------

export type Earnings = {
  /** Deposits + booking fees captured. */
  capturedCents: number;
  refundedCents: number;
  /** Sent or paid out to her PayPal. */
  paidOutCents: number;
  /** Queued, not sent yet. */
  pendingPayoutCents: number;
  /** Booking fees captured (Kitoko's). */
  feesCents: number;
  currency: Currency;
  /** Bookings with a captured deposit. */
  bookings: number;
  /** PayPal Reporting rows of her bookings (best effort; sandbox lags by hours), null when unavailable. */
  paypal: { rows: TransactionRow[]; lastRefreshed: string | null } | null;
};

/**
 * Her money for the appointments in [from, to): every deposit captured for them (whenever it was captured, seeded
 * SEED- captures included), their refunds, payouts and booking fees, from our own rows. PayPal Reporting rows of
 * those bookings are added as a separate, best-effort part when PayPal answers (never fails the call).
 */
export async function earnings(ctx: ServicesCtx, i: { proId: string; from: number | string | Date; to: number | string | Date }): Promise<Result<Earnings, string>> {
  const from = new Date(i.from).getTime();
  const to = new Date(i.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return err("invalid_dates");
  const money = await listProMoney(ctx.db, i.proId, { from, to });
  const captured = money.payments.filter((p) => p.status === "captured" || p.status === "refunded");
  const result: Earnings = {
    capturedCents: captured.reduce((s, p) => s + p.amountCents, 0),
    refundedCents: money.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amountCents, 0),
    paidOutCents: money.payouts.filter((p) => p.status === "sent" || p.status === "succeeded").reduce((s, p) => s + p.amountCents, 0),
    pendingPayoutCents: money.payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amountCents, 0),
    feesCents: captured.reduce((s, p) => s + p.feeCents, 0),
    currency: money.currency,
    bookings: new Set(captured.map((p) => p.bookingId)).size,
    paypal: null,
  };

  try {
    // Deposits are captured before the appointment: the PayPal window starts at the first capture of these bookings.
    const firstCapture = Math.min(from, ...captured.map((p) => p.capturedAt ?? p.createdAt));
    const end = Math.min(to, nowMs(ctx));
    const start = Math.max(firstCapture, end - 31 * 86_400_000 + 60_000);
    if (end > start) {
      const report = await Promise.race([
        listTransactions({ start: new Date(start), end: new Date(end) }, ctx.paypal),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (report?.ok) {
        const bookingIds = new Set(money.payments.map((p) => p.bookingId));
        const captureIds = new Set(money.payments.flatMap((p) => (p.captureId ? [p.captureId] : [])));
        const rows = report.value.rows.filter((r) => (r.customId && bookingIds.has(r.customId)) || (r.referenceId && captureIds.has(r.referenceId)));
        result.paypal = { rows, lastRefreshed: report.value.lastRefreshed };
      }
    }
  } catch (e) {
    console.warn("[services] PayPal Reporting failed", e);
  }
  return ok(result);
}

/** Bookings of a pro by id or 6-character ref. */
export async function findProBooking(ctx: ServicesCtx, proId: string, idOrRef: string): Promise<BookingDetail | null> {
  const key = idOrRef.trim();
  const query = ctx.db.from("bookings").select(BOOKING_COLUMNS).eq("pro_id", proId);
  const { data, error } = await (/^[0-9a-f-]{36}$/i.test(key) ? query.eq("id", key) : query.eq("ref", key.toUpperCase())).maybeSingle();
  if (error) throw error;
  return data ? toBookingDetail(data) : null;
}
