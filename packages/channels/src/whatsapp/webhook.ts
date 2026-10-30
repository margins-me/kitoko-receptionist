import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fromWaId } from "./phone";

/**
 * Checks Meta's `X-Hub-Signature-256` header ("sha256=<hex>"): an HMAC-SHA256 of the raw request body keyed with the
 * app secret. Pass the body exactly as received (`await request.text()`), never re-serialized JSON.
 */
export function verifySignature(rawBody: string | Uint8Array, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const hex = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())?.[1];
  if (!hex) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(hex, "hex"), expected);
}

/**
 * The GET handshake Meta sends when the callback URL or verify token is saved: answer 200 with `hub.challenge` when
 * the token matches, anything else otherwise. Returns the challenge to echo, or null to refuse.
 */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const challenge = params.get("hub.challenge");
  if (!verifyToken || !challenge || params.get("hub.mode") !== "subscribe") return null;
  return sameText(params.get("hub.verify_token") ?? "", verifyToken) ? challenge : null;
}

// Hashing first gives equal lengths, so the comparison takes the same time whatever the input.
function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** One message a WhatsApp user sent us. */
export type InboundMessage = {
  /** E.164 with "+". */
  from: string;
  messageId: string;
  /** Epoch milliseconds (Meta sends seconds). */
  timestamp: number;
  /** The WhatsApp profile name, when Meta sends one. */
  name?: string;
  /** "text": typed text. "button": a reply-button tap (buttonId set, text = the button title). "unsupported": media, location, etc. */
  kind: "text" | "button" | "unsupported";
  text?: string;
  buttonId?: string;
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | undefined => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : undefined);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);

/**
 * The messages in a `messages` webhook (entry[].changes[].value.messages[]). Status updates (value.statuses) and
 * anything malformed are skipped, so the route can always answer 200.
 */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of arr(obj(payload)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value);
      if (!value) continue;
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str(obj(c)?.wa_id);
        const name = str(obj(obj(c)?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }
      for (const m of arr(value.messages)) {
        const parsed = parseMessage(obj(m), names);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

function parseMessage(m: Obj | undefined, names: Map<string, string>): InboundMessage | null {
  const waId = str(m?.from);
  const messageId = str(m?.id);
  if (!m || !waId || !messageId) return null;
  const seconds = Number(m.timestamp);
  const base = {
    from: fromWaId(waId),
    messageId,
    timestamp: Number.isFinite(seconds) ? seconds * 1000 : Date.now(),
    ...(names.has(waId) ? { name: names.get(waId) } : {}),
  };

  if (m.type === "text") {
    const text = str(obj(m.text)?.body);
    return text ? { ...base, kind: "text", text } : { ...base, kind: "unsupported" };
  }
  if (m.type === "interactive") {
    const i = obj(m.interactive);
    const reply = obj(i?.button_reply) ?? obj(i?.list_reply);
    const id = str(reply?.id);
    if (id) return { ...base, kind: "button", buttonId: id, ...(str(reply?.title) ? { text: str(reply?.title) } : {}) };
  }
  // A quick-reply button on a template message.
  if (m.type === "button") {
    const b = obj(m.button);
    const id = str(b?.payload);
    if (id) return { ...base, kind: "button", buttonId: id, ...(str(b?.text) ? { text: str(b?.text) } : {}) };
  }
  return { ...base, kind: "unsupported" };
}
