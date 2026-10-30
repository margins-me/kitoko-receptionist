import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handlePayPalWebhook } from "@kitoko/agent/services";
import { requestServicesCtx } from "@/lib/services";

// PayPal webhooks: verified with verify-webhook-signature, stored once by event id, then dispatched to the services
// (handlePayPalWebhook documents every reply). PayPal retries any non-2xx reply.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const reply = await handlePayPalWebhook(requestServicesCtx(), { headers: request.headers, body });
  return NextResponse.json(reply.body, { status: reply.status });
}
