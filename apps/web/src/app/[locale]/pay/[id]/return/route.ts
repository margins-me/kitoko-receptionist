import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { capturePayment, isUuid } from "@kitoko/agent/services";
import { getPaymentByOrderId } from "@kitoko/db";
import { isLocale } from "@kitoko/i18n";
import { requestServicesCtx } from "@/lib/services";

// PayPal's return URL (/pay/{id}/return?token={orderId}&PayerID=…): capture, then back to the deposit page, which
// shows the outcome. The webhook PAYMENT.CAPTURE.COMPLETED is the backstop when the buyer never comes back.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const prefix = isLocale(locale) && locale !== "en" ? `/${locale}` : "";
  const page = new URL(`${prefix}/pay/${id}`, request.nextUrl.origin);
  const orderId = request.nextUrl.searchParams.get("token");
  if (!isUuid(id) || !orderId || orderId.length > 64) return NextResponse.redirect(page, 303);

  const ctx = requestServicesCtx(request.nextUrl.origin);
  const payment = await getPaymentByOrderId(ctx.db, orderId);
  if (payment?.bookingId === id) {
    const r = await capturePayment(ctx, { orderId });
    if (!r.ok) page.searchParams.set("error", r.error);
    else if (r.value.outcome === "pending") page.searchParams.set("pending", "1");
  }
  return NextResponse.redirect(page, 303);
}
