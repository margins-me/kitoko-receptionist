import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInbound, verifyChallenge, verifySignature } from "../../src/whatsapp/webhook";

const secret = "app-secret";
const sign = (body: string, key = secret) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

// Shapes from developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages.
const envelope = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes: [{ value, field: "messages" }] }],
});
const metadata = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };
const contacts = [{ profile: { name: "Awa Diallo" }, wa_id: "33612345678" }];

describe("verifySignature", () => {
  const body = JSON.stringify(envelope({ messaging_product: "whatsapp", metadata }));

  it("accepts the HMAC-SHA256 of the raw body with the app secret", () => {
    expect(verifySignature(body, sign(body), secret)).toBe(true);
    expect(verifySignature(new TextEncoder().encode(body), sign(body).toUpperCase().replace("SHA256=", "sha256="), secret)).toBe(true);
  });

  it("signs the bytes, so non-ASCII text must stay as received", () => {
    const raw = '{"text":"Ça marche, à demain"}';
    expect(verifySignature(raw, sign(raw), secret)).toBe(true);
    expect(verifySignature(JSON.stringify(JSON.parse(raw)).replace("Ç", "\\u00c7"), sign(raw), secret)).toBe(false);
  });

  it("rejects a tampered body, another secret, a missing or malformed header and an empty secret", () => {
    expect(verifySignature(`${body} `, sign(body), secret)).toBe(false);
    expect(verifySignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", "sha1="), secret)).toBe(false);
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("verifyChallenge", () => {
  const params = (token: string, mode = "subscribe") =>
    new URLSearchParams({ "hub.mode": mode, "hub.challenge": "1158201444", "hub.verify_token": token });

  it("returns the challenge when the token matches", () => {
    expect(verifyChallenge(params("vibecoding"), "vibecoding")).toBe("1158201444");
  });

  it("refuses a wrong token, another mode, a missing challenge or an unset server token", () => {
    expect(verifyChallenge(params("nope"), "vibecoding")).toBeNull();
    expect(verifyChallenge(params("vibecoding", "unsubscribe"), "vibecoding")).toBeNull();
    expect(verifyChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "vibecoding" }), "vibecoding")).toBeNull();
    expect(verifyChallenge(params(""), "")).toBeNull();
  });
});

describe("parseInbound", () => {
  it("reads a text message with the sender's name, as E.164 and epoch ms", () => {
    const payload = envelope({
      messaging_product: "whatsapp",
      metadata,
      contacts,
      messages: [{ from: "33612345678", id: "wamid.T1", timestamp: "1749416383", type: "text", text: { body: "Hi, can I book braids?" } }],
    });
    expect(parseInbound(payload)).toEqual([
      { from: "+33612345678", messageId: "wamid.T1", timestamp: 1749416383000, name: "Awa Diallo", kind: "text", text: "Hi, can I book braids?" },
    ]);
  });

  it("reads a reply-button tap", () => {
    const payload = envelope({
      messaging_product: "whatsapp",
      metadata,
      contacts,
      messages: [
        {
          context: { from: "15550783881", id: "wamid.PREV" },
          from: "33612345678",
          id: "wamid.B1",
          timestamp: "1714510003",
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "confirm:pa_1", title: "Confirm" } },
        },
      ],
    });
    expect(parseInbound(payload)).toEqual([
      { from: "+33612345678", messageId: "wamid.B1", timestamp: 1714510003000, name: "Awa Diallo", kind: "button", buttonId: "confirm:pa_1", text: "Confirm" },
    ]);
  });

  it("reads a template quick-reply button by its payload", () => {
    const payload = envelope({
      messaging_product: "whatsapp",
      metadata,
      messages: [{ from: "33612345678", id: "wamid.Q1", timestamp: "1714510003", type: "button", button: { payload: "yes:bk_1", text: "Yes" } }],
    });
    expect(parseInbound(payload)).toEqual([
      { from: "+33612345678", messageId: "wamid.Q1", timestamp: 1714510003000, kind: "button", buttonId: "yes:bk_1", text: "Yes" },
    ]);
  });

  it("returns nothing for a status-only payload", () => {
    const payload = envelope({
      messaging_product: "whatsapp",
      metadata,
      statuses: [{ id: "wamid.S1", status: "delivered", timestamp: "1750263773", recipient_id: "33612345678" }],
    });
    expect(parseInbound(payload)).toEqual([]);
  });

  it("flags media and other types as unsupported so the route can say it reads text only", () => {
    const payload = envelope({
      messaging_product: "whatsapp",
      metadata,
      messages: [{ from: "33612345678", id: "wamid.I1", timestamp: "1714510003", type: "image", image: { id: "123", mime_type: "image/jpeg" } }],
    });
    expect(parseInbound(payload)).toEqual([{ from: "+33612345678", messageId: "wamid.I1", timestamp: 1714510003000, kind: "unsupported" }]);
  });

  it("skips malformed input instead of throwing", () => {
    for (const junk of [null, "x", 42, [], {}, { entry: "x" }, { entry: [{ changes: [{ value: { messages: [{ type: "text" }] } }] }] }]) {
      expect(parseInbound(junk)).toEqual([]);
    }
  });

  it("reads every message of a batched payload", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        { id: "1", changes: [{ field: "messages", value: { messages: [{ from: "1", id: "a", timestamp: "1", type: "text", text: { body: "one" } }] } }] },
        { id: "2", changes: [{ field: "messages", value: { messages: [{ from: "2", id: "b", timestamp: "2", type: "text", text: { body: "two" } }] } }] },
      ],
    };
    expect(parseInbound(payload).map((m) => [m.from, m.text])).toEqual([
      ["+1", "one"],
      ["+2", "two"],
    ]);
  });
});
