import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getFakePayPal } from "@kitoko/paypal";

// DEV ONLY (PAYPAL_ENV=fake): stands in for PayPal's approval page. The buyer "approves" the fake order and is sent to
// the order's return URL, exactly like PayPal would.
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (process.env.PAYPAL_ENV?.trim() !== "fake") return new NextResponse("Not found", { status: 404 });
  const orderId = request.nextUrl.searchParams.get("token") ?? "";
  const approved = getFakePayPal().approve(orderId, { givenName: "Ada", surname: "Sandbox", email: "buyer@example.com" });
  if (!approved) return new NextResponse("Unknown order, or it is not waiting for approval.", { status: 404 });
  return NextResponse.redirect(approved.returnUrl, 303);
}
