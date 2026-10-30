"use server";

import { rulesText } from "@kitoko/booking";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { bookingClient, capturePayment, createDepositLink, isUuid, openDepositPage, saveClientDetails as saveDetails } from "@kitoko/agent/services";
import { getBooking, getPaymentByOrderId, getPro } from "@kitoko/db";
import { actionServicesCtx } from "@/lib/services";

// The deposit page's server actions. Amounts always come from the booking row; the browser only sends ids.

export type PayState = {
  booking: {
    id: string;
    ref: string;
    /** held | confirmed | honoured | no_show | cancelled | expired */
    status: string;
    start: string;
    end: string;
    serviceName: string;
    staffName: string;
    proName: string;
    proHandle: string;
    city: string | null;
    priceCents: number;
    depositCents: number;
    feeCents: number;
    currency: string;
    holdExpiresAt: string | null;
    locale: string;
    timeZone: string;
  };
  /** The deposit payment (captured one first, else the latest order). status: created | approved | captured | refunded | denied */
  payment: { status: string; orderId: string } | null;
  policyText: string;
  /** Who the booking is for, as far as we know (prefills "Your details"). Only while it waits for payment. */
  client: { firstName: string | null; phone: string | null } | null;
  paypal: { mode: "sandbox" | "fake"; clientId: string | null };
};

const iso = (ms: number) => new Date(ms).toISOString();

export async function getPayState(bookingId: string): Promise<PayState | null> {
  if (!isUuid(bookingId)) return null;
  const ctx = await actionServicesCtx();
  const booking = await getBooking(ctx.db, bookingId);
  if (!booking) return null;
  const pro = await getPro(ctx.db, booking.proId);
  if (!pro) return null;
  const deposits = booking.payments.filter((p) => p.kind === "deposit");
  const payment =
    deposits.find((p) => p.status === "captured" || p.status === "refunded") ?? deposits.toSorted((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  const fake = (process.env.PAYPAL_ENV?.trim() || "sandbox") === "fake";
  const client = booking.status === "held" ? await bookingClient(ctx, booking) : null;
  return {
    booking: {
      id: booking.id,
      ref: booking.ref,
      status: booking.status,
      start: iso(booking.start),
      end: iso(booking.end),
      serviceName: booking.service.name,
      staffName: booking.staff.name,
      proName: pro.name,
      proHandle: pro.handle,
      city: pro.city,
      priceCents: booking.priceCents,
      depositCents: booking.depositCents,
      feeCents: booking.feeCents,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt === null ? null : iso(booking.holdExpiresAt),
      locale: booking.locale,
      timeZone: pro.timezone,
    },
    payment: payment ? { status: payment.status, orderId: payment.paypalOrderId } : null,
    policyText: rulesText(booking.policy, booking.locale, booking.currency).join(" "),
    client,
    paypal: { mode: fake ? "fake" : "sandbox", clientId: fake ? null : process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || null },
  };
}

/**
 * The deposit page was opened: the first time, a held booking's hold runs at least 15 more minutes from now (never
 * shortened; once per booking). Errors are ignored: the page still shows the booking as it is.
 */
export async function openPayPage(bookingId: string): Promise<void> {
  if (!isUuid(bookingId)) return;
  await openDepositPage(await actionServicesCtx(), { bookingId }).catch(() => undefined);
}

/** The PayPal order for the booking's deposit (reuses the open one). The JS SDK starts its session with orderId. */
export async function createPayPalOrder(bookingId: string): Promise<{ ok: true; orderId: string; approveUrl: string } | { ok: false; error: string }> {
  if (!isUuid(bookingId)) return { ok: false, error: "not_found" };
  const link = await createDepositLink(await actionServicesCtx(), { bookingId });
  if (!link.ok) return { ok: false, error: link.error };
  if (link.value.confirmed || !link.value.orderId || !link.value.approveUrl) return { ok: false, error: "nothing_due" };
  return { ok: true, orderId: link.value.orderId, approveUrl: link.value.approveUrl };
}

/**
 * Captures an approved order of this booking. status: confirmed | already_captured | pending (PayPal holds the funds,
 * the webhook confirms later) | slot_lost (refunded in full) | duplicate (refunded). error: declined (approve again
 * with another funding source), not_approved, paypal_unavailable, ...
 */
export async function capturePayPalOrder(bookingId: string, orderId: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  if (!isUuid(bookingId) || typeof orderId !== "string" || orderId.length > 64) return { ok: false, error: "not_found" };
  const ctx = await actionServicesCtx();
  const payment = await getPaymentByOrderId(ctx.db, orderId);
  if (!payment || payment.bookingId !== bookingId) return { ok: false, error: "not_found" };
  const r = await capturePayment(ctx, { orderId });
  return r.ok ? { ok: true, status: r.value.outcome } : { ok: false, error: r.error };
}

/**
 * "Your details" on the deposit page: her first name (required) and mobile (optional, E.164), kept on the booking's
 * conversation so the capture confirms the booking with them. error: invalid_name, invalid_phone, not_payable, not_found.
 */
export async function saveClientDetails(
  bookingId: string,
  details: { firstName: string; phone?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(bookingId) || typeof details?.firstName !== "string") return { ok: false, error: "not_found" };
  let phone: string | null = null;
  if (typeof details.phone === "string" && details.phone.trim()) {
    const parsed = parsePhoneNumberFromString(details.phone.trim());
    if (!parsed?.isValid()) return { ok: false, error: "invalid_phone" };
    phone = parsed.number;
  }
  const r = await saveDetails(await actionServicesCtx(), { bookingId, firstName: details.firstName, phone });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
