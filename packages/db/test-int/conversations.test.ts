import { afterAll, describe, expect, it } from "vitest";
import {
  appendMessage,
  createPendingAction,
  decidePendingAction,
  getConversation,
  getOrCreateConversation,
  listAgentEvents,
  listBookings,
  listConversations,
  listMessages,
  listPendingActions,
  logAgentEvent,
  updateConversation,
} from "../src";
import { KEMI, proClient, svc } from "./fixtures";

const created: string[] = [];
afterAll(async () => {
  await svc().from("conversations").delete().in("id", created).throwOnError();
  await svc().from("pending_actions").delete().eq("pro_id", KEMI).like("summary", "TEST %").throwOnError();
  await svc().from("agent_events").delete().eq("pro_id", KEMI).like("name", "test_%").throwOnError();
});

describe("conversations", () => {
  it("creates a web chat with a token, and finds a WhatsApp chat by number", async () => {
    const db = svc();
    const web = await getOrCreateConversation(db, { proId: KEMI, kind: "client", channel: "web", locale: "en" });
    created.push(web.id);
    expect(web.token).toMatch(/^[0-9a-f]{64}$/);
    expect(web.externalId).toBe(web.token);

    const wa = await getOrCreateConversation(db, { proId: KEMI, kind: "client", channel: "whatsapp", externalId: "447700900777" });
    created.push(wa.id);
    expect((await getOrCreateConversation(db, { proId: KEMI, kind: "client", channel: "whatsapp", externalId: "447700900777" })).id).toBe(wa.id);
    await updateConversation(db, wa.id, { locale: "fr" });
    expect((await getConversation(db, wa.id))?.locale).toBe("fr");
    expect((await listConversations(db, KEMI)).map((c) => c.id)).toContain(wa.id);
  });

  it("appends and polls messages", async () => {
    const db = svc();
    const chat = await getOrCreateConversation(db, { proId: KEMI, kind: "client", channel: "web" });
    created.push(chat.id);
    const hi = await appendMessage(db, { conversationId: chat.id, role: "user", content: [{ type: "text", text: "Hi" }] });
    await appendMessage(db, { conversationId: chat.id, role: "user", content: [{ type: "text", text: "[event] payment captured" }], visible: false });
    await appendMessage(db, { conversationId: chat.id, role: "assistant", content: [{ type: "text", text: "Booked!" }] });
    expect((await listMessages(db, chat.id)).map((m) => m.role)).toEqual(["user", "user", "assistant"]);
    expect((await listMessages(db, chat.id, { after: hi.id, visibleOnly: true })).map((m) => m.content)).toEqual([[{ type: "text", text: "Booked!" }]]);
    expect((await getConversation(db, chat.id))?.lastMessageAt).not.toBeNull();
  });

  it("logs agent events for a conversation and a booking", async () => {
    const db = svc();
    const chat = await getOrCreateConversation(db, { proId: KEMI, kind: "client", channel: "mcp", externalId: `test-${Date.now()}` });
    created.push(chat.id);
    const now = Date.now();
    const [booking] = await listBookings(db, KEMI, now - 86_400_000, now + 14 * 86_400_000);
    await logAgentEvent(db, { conversationId: chat.id, name: "test_list_services", input: { proId: KEMI }, output: { count: 3 }, ms: 12.4 });
    await logAgentEvent(db, { bookingId: booking!.id, kind: "paypal", name: "test_capture", output: { status: "COMPLETED" } });
    const ofChat = await listAgentEvents(db, { conversationId: chat.id });
    expect(ofChat.map((e) => [e.name, e.proId, e.ms])).toEqual([["test_list_services", KEMI, 12]]);
    const ofBooking = await listAgentEvents(db, { bookingId: booking!.id });
    expect(ofBooking.map((e) => [e.kind, e.name])).toContainEqual(["paypal", "test_capture"]);
  });

  it("waits for the pro's button press on money actions", async () => {
    const db = svc();
    const action = await createPendingAction(db, { proId: KEMI, kind: "refund", summary: "TEST refund 10 GBP", amountCents: 1000, currency: "GBP", payload: { paymentId: "x" } });
    expect(action.status).toBe("pending");
    expect((await listPendingActions(db, KEMI, { status: "pending" })).map((a) => a.id)).toContain(action.id);

    const aicha = await proClient("aicha@demo.kitoko.page");
    expect(await decidePendingAction(aicha, action.id, "confirmed")).toEqual({ ok: false, error: "not_found" });
    const kemi = await proClient("kemi@demo.kitoko.page");
    const decided = await decidePendingAction(kemi, action.id, "confirmed");
    expect(decided).toMatchObject({ ok: true, value: { id: action.id, status: "confirmed" } });
    expect(await decidePendingAction(db, action.id, "cancelled")).toEqual({ ok: false, error: "not_pending" });
  });
});
