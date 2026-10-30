import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleMessage } from "@kitoko/agent/services";
import type { ServicesCtx } from "@kitoko/agent/services";
import { parseInbound, verifyChallenge, verifySignature } from "@kitoko/channels";
import type { InboundMessage } from "@kitoko/channels";
import { getProByHandle } from "@kitoko/db";
import { getServicesCtx } from "@/lib/services";

// WhatsApp Cloud API inbound: GET is Meta's verification handshake; POST carries messages, signed with the app secret.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(request: NextRequest) {
  const challenge = verifyChallenge(request.nextUrl.searchParams, process.env.WHATSAPP_VERIFY_TOKEN ?? "");
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!verifySignature(body, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET ?? "")) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const messages = parseInbound(payload);
  // Answer Meta at once (it retries slow webhooks); the agents run after the response.
  if (messages.length) {
    const ctx = getServicesCtx();
    after(async () => {
      for (const m of messages) {
        try {
          await route(ctx, m);
        } catch (e) {
          console.error("[whatsapp/webhook] message failed", m.messageId, e);
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}

/** The pro herself (her number is pros.whatsapp_e164) talks to her assistant; anyone else is a client of the demo pro. */
async function route(ctx: ServicesCtx, m: InboundMessage) {
  const { data: pro } = await ctx.db.from("pros").select("id").eq("whatsapp_e164", m.from).maybeSingle();
  const text = m.kind === "unsupported" ? "(The client sent a photo, audio or another message type you cannot read.)" : (m.text ?? "");
  const button = m.kind === "button" && m.buttonId ? { buttonId: m.buttonId } : {};
  if (pro) {
    const r = await handleMessage(ctx, { channel: "whatsapp", externalId: m.from, kind: "pro", proId: pro.id, text, ...button });
    if (!r.ok) console.warn("[whatsapp/webhook] pro message refused", r.error);
    return;
  }
  const handle = process.env.WHATSAPP_DEMO_PRO;
  const demo = handle ? await getProByHandle(ctx.db, handle) : null;
  if (!demo) {
    console.warn("[whatsapp/webhook] WHATSAPP_DEMO_PRO is not a pro handle:", handle);
    return;
  }
  const r = await handleMessage(ctx, { channel: "whatsapp", externalId: m.from, kind: "client", proId: demo.id, text, ...button });
  if (!r.ok) console.warn("[whatsapp/webhook] client message refused", r.error);
}
