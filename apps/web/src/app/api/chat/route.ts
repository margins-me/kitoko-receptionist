import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { LOCALES } from "@kitoko/i18n";
import { chatMessages, handleMessage } from "@kitoko/agent/services";
import type { HandleEvent, HandleMessageInput } from "@kitoko/agent/services";
import { getServicesCtx, requestServicesCtx } from "@/lib/services";
import { getSessionUserId } from "@/lib/supabase/server";

// The web chat (client, on a pro's page) and the pro's assistant (dashboard). NDJSON stream, see docs/architecture.md.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ClientBody = z.object({
  handle: z.string().trim().min(1).max(64),
  token: z.string().min(16).max(128).optional(),
  text: z.string().trim().min(1).max(2000),
  locale: z.enum(LOCALES).optional(),
  /** The WhatsApp simulator's id: the same receptionist on the WhatsApp channel, its replies read back from the rows. */
  whatsapp: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
});
const ProBody = z.object({ kind: z.literal("pro"), text: z.string().trim().min(1).max(4000) });

const STATUS: Record<string, number> = { rate_limited: 429, pro_not_found: 404, empty_message: 400, message_too_long: 400 };

type WireEvent =
  | { type: "token"; token: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "done" | "error" }
  | { type: "choices"; choices: string[] }
  | { type: "ledger"; filter: Record<string, unknown> }
  | { type: "done" };

function toWire(e: HandleEvent, kind: "client" | "pro"): WireEvent | null {
  switch (e.type) {
    case "conversation":
      return e.created && kind === "client" ? { type: "token", token: e.token } : null;
    case "text_delta":
      return { type: "text", delta: e.text };
    case "tool_call":
      // offer_choices is not work the client waits on: its buttons come with its result.
      return e.name === "offer_choices" ? null : { type: "tool", name: e.name, status: "start" };
    case "tool_result": {
      const choices = (e.output as { choices?: unknown } | null)?.choices;
      if (e.name === "offer_choices" && !e.isError && Array.isArray(choices)) return { type: "choices", choices: choices.map(String) };
      const filter = (e.output as { filter?: unknown } | null)?.filter;
      if (e.name === "show_money" && !e.isError && filter && typeof filter === "object") return { type: "ledger", filter: filter as Record<string, unknown> };
      return { type: "tool", name: e.name, status: e.isError ? "error" : "done" };
    }
    default:
      return null;
  }
}

/**
 * The simulator's number: +999 (a country code no one has) and 11 digits from the id, so it never matches a real
 * client's phone and only its own browser knows the id.
 */
function simulatedPhone(id: string): string {
  const digits = BigInt(`0x${createHash("sha256").update(id).digest("hex").slice(0, 16)}`).toString().padStart(11, "0").slice(-11);
  return `+999${digits}`;
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let input: Omit<HandleMessageInput, "onEvent">;
  let kind: "client" | "pro";
  const pro = ProBody.safeParse(json);
  if (pro.success) {
    const proId = await getSessionUserId();
    if (!proId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    kind = "pro";
    input = { channel: "web", kind, proId, externalId: "dashboard", text: pro.data.text };
  } else {
    const client = ClientBody.safeParse(json);
    if (!client.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    kind = "client";
    input = {
      ...(client.data.whatsapp ? { channel: "whatsapp", externalId: simulatedPhone(client.data.whatsapp) } : { channel: "web" }),
      kind,
      proHandle: client.data.handle,
      text: client.data.text,
      ...(client.data.token ? { token: client.data.token } : {}),
      ...(client.data.locale ? { locale: client.data.locale } : {}),
    };
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const buffered: Uint8Array[] = [];
  let live = false;
  const emit = (event: WireEvent) => {
    const bytes = encoder.encode(`${JSON.stringify(event)}\n`);
    if (live) void writer.write(bytes).catch(() => undefined);
    else buffered.push(bytes);
  };

  let agentStarted!: () => void;
  const firstAgentEvent = new Promise<"agent">((resolve) => (agentStarted = () => resolve("agent")));
  const run = handleMessage(requestServicesCtx(request.nextUrl.origin), {
    ...input,
    onEvent: (e) => {
      if (e.type !== "conversation") agentStarted();
      const wire = toWire(e, kind);
      if (wire) emit(wire);
    },
  });

  // Refusals (rate limit, unknown pro) come back before the model runs: answer them with a status, not a stream.
  const first = await Promise.race([firstAgentEvent, run.then(() => "result" as const, () => "result" as const)]);
  if (first === "result") {
    const result = await run.catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "internal_error" }));
    if (!result.ok) {
      console.error("[api/chat]", result.error);
      return NextResponse.json({ error: STATUS[result.error] ? result.error : "internal_error" }, { status: STATUS[result.error] ?? 500 });
    }
  }

  live = true;
  for (const bytes of buffered) void writer.write(bytes).catch(() => undefined);
  void run
    .then((result) => {
      if (!result.ok) console.error("[api/chat]", result.error);
    })
    .catch((e: unknown) => console.error("[api/chat]", e))
    .finally(() => {
      emit({ type: "done" });
      void writer.close().catch(() => undefined);
    });

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

/** Visible messages of a web chat after `after` (ISO), for polling proactive messages. 404 when the chat is gone. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const afterParam = request.nextUrl.searchParams.get("after");
  if (token.length < 16 || token.length > 128) return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  const after = afterParam ? Date.parse(afterParam) : NaN;
  const result = await chatMessages(getServicesCtx(), { token, ...(Number.isNaN(after) ? {} : { after }) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 500 });
  return NextResponse.json(
    { messages: result.value.map((m) => ({ id: String(m.id), role: m.role, text: m.text, createdAt: m.createdAt, ...(m.choices ? { choices: m.choices } : {}) })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
