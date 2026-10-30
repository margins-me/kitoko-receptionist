import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { callTool } from "@kitoko/agent/core/tools";
import { createServicesCtx } from "@kitoko/agent/services";
import { clientTools } from "@kitoko/agent/tools";
import type { ClientToolCtx } from "@kitoko/agent/tools";
import { addDays, localDate } from "@kitoko/booking";
import { getBookingByRef, getOrCreateConversation, getProByHandle, listAgentEvents, serviceClient } from "@kitoko/db";
import { createKitokoMcpServer } from "../src/server";
import type { KitokoMcpOptions } from "../src/server";

// Against the local stack with the seeded pros (supabase/seed.sql) and PAYPAL_ENV=fake (test-int/setup.ts).

const db = serviceClient();
const held: string[] = [];
const webConversations: string[] = [];
const startedAt = new Date().toISOString();
const ANTA = "a0000000-0000-4000-8000-000000000005";
const ANTA_CORNROWS = "b0000000-0000-4000-8000-000000000052";

// Leaves the local data as it found it, whatever runs next (pgTAP, the other suites): the bookings made here (their
// payments cascade), their conversations (messages and agent events cascade) and the MCP calls logged since this
// file started.
afterAll(async () => {
  if (webConversations.length) {
    const { data: chat } = await db.from("bookings").select("id").in("conversation_id", webConversations).throwOnError();
    held.push(...(chat ?? []).map((b) => b.id));
  }
  const { data: rows } = await db.from("bookings").select("conversation_id, conversations (client_id)").in("id", held).throwOnError();
  await db.from("bookings").delete().in("id", held).throwOnError();
  const conversations = (rows ?? []).flatMap((r) => (r.conversation_id ? [r.conversation_id] : []));
  const clients = (rows ?? []).flatMap((r) => {
    const c = (Array.isArray(r.conversations) ? r.conversations[0] : r.conversations) as { client_id: string | null } | null;
    return c?.client_id ? [c.client_id] : [];
  });
  conversations.push(...webConversations);
  if (conversations.length) await db.from("conversations").delete().in("id", conversations).throwOnError();
  if (clients.length) await db.from("clients").delete().in("id", clients).throwOnError();
  // MCP calls logged since this file started (about no pro, or a pro but no booking left: get_availability, refusals).
  await db.from("agent_events").delete().like("name", "mcp.%").gte("created_at", startedAt).throwOnError();
});

async function connect(options: KitokoMcpOptions = {}) {
  const server = createKitokoMcpServer(() => createServicesCtx(process.env), options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "int-test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: Json }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
  return { isError: result.isError === true, body: JSON.parse(text) as Json };
}

/** The next Saturday after today, in Milan. */
function nextSaturday(): string {
  let day = addDays(localDate(Date.now(), "Europe/Rome"), 1);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 6) day = addDays(day, 1);
  return day;
}

describe("search_pros on the seed", () => {
  it("filters by city, service and price", async () => {
    const client = await connect();
    const milan = await call(client, "search_pros", { city: "Milano", service: "knotless braids", max_price: 150 });
    expect(milan.isError).toBe(false);
    expect(milan.body.pros.map((p: Json) => p.pro_handle).toSorted()).toEqual(["aicha.braids", "anta.tresses"]);
    const aicha = milan.body.pros.find((p: Json) => p.pro_handle === "aicha.braids");
    expect(aicha.page_url).toMatch(/\/aicha\.braids$/);
    expect(aicha.service.name).toBe("Knotless braids");
    expect(aicha.service.from_price.cents).toBeLessThanOrEqual(15_000);

    const cheap = await call(client, "search_pros", { city: "Milan", service: "knotless braids", max_price: 20 });
    expect(cheap.body.pros).toEqual([]);
    const lyon = await call(client, "search_pros", { city: "Lyon", service: "knotless braids" });
    expect(lyon.body.pros.map((p: Json) => p.pro_handle)).not.toContain("aicha.braids");
    const gbp = await call(client, "search_pros", { currency: "GBP" });
    expect(gbp.body.pros.map((p: Json) => p.pro_handle)).toEqual(["kemi.nails"]);
  });
});

describe("shop for me", () => {
  it("knotless braids in Milan this Saturday morning under €150: Aïcha and Anta side by side", async () => {
    const client = await connect();
    const saturday = nextSaturday();
    const search = await call(client, "search_pros", {
      city: "Milan",
      service: "knotless braids",
      max_price: 150,
      date: saturday,
      time_of_day: "morning",
    });
    expect(search.isError, JSON.stringify(search.body)).toBe(false);
    expect(search.body).toMatchObject({ date: saturday, time_of_day: "morning", count: 2 });
    const byHandle = Object.fromEntries(search.body.pros.map((p: Json) => [p.pro_handle, p]));
    expect(Object.keys(byHandle).toSorted()).toEqual(["aicha.braids", "anta.tresses"]);

    // The seed keeps next Saturday's first start free for knotless (supabase/migrations/..._second_milan_pro.sql).
    expect(byHandle["aicha.braids"].free_times[0].local).toMatch(/09:00$/);
    expect(byHandle["anta.tresses"].free_times[0].local).toMatch(/10:00$/);
    for (const p of search.body.pros) {
      expect(p.free_times.length).toBeGreaterThanOrEqual(1);
      expect(p.free_times.length).toBeLessThanOrEqual(4);
      for (const t of p.free_times) expect(t.start.slice(0, 10) <= saturday && Date.parse(t.start) > Date.now()).toBe(true);
      expect(p.service.name).toBe("Knotless braids");
      expect(p.area).toMatch(/^Milano, /);
      expect(p.pay_now.total.cents).toBe(p.pay_now.deposit.cents + p.pay_now.booking_fee.cents);
      expect(p.balance_at_salon.cents).toBe(p.service.price.cents - p.pay_now.deposit.cents);
      expect(p.cancellation).toMatch(/^Free cancellation up to 48\sh before; after that the deposit is kept\.$/);
    }
    // Default options: Aïcha €145 (375 min), Anta €80 (240 min); both from the seed, through @kitoko/booking.
    expect(byHandle["aicha.braids"].service).toMatchObject({ minutes: 375, price: { cents: 14_500 }, from_price: { cents: 8_500 } });
    expect(byHandle["anta.tresses"].service).toMatchObject({ minutes: 240, price: { cents: 8_000 }, from_price: { cents: 8_000 } });
    // Sorted by earliest free time: 09:00 before 10:00.
    expect(search.body.pros.map((p: Json) => p.pro_handle)).toEqual(["aicha.braids", "anta.tresses"]);
    expect(search.body.note).toContain("Never claim reviews or ratings");

    // The human picks Anta at 10:00: book_with_deposit takes the start from search_pros as is.
    const anta = byHandle["anta.tresses"];
    const booking = await call(client, "book_with_deposit", {
      pro_handle: anta.pro_handle,
      service_id: anta.service.service_id,
      start: anta.free_times[0].start,
      first_name: "Ada",
    });
    expect(booking.isError, JSON.stringify(booking.body)).toBe(false);
    expect(booking.body).toMatchObject({ status: "held", service: "Knotless braids", start: anta.free_times[0].start, staff: "Anta" });
    expect(booking.body.amounts.total_now.cents).toBe(anta.pay_now.total.cents);
    expect(booking.body.approval_url).toMatch(/^https?:\/\//);
    const stored = await getBookingByRef(db, booking.body.ref);
    held.push(stored!.id);

    // Her 10:00 is gone from the next search; Aïcha's 09:00 is still there.
    const again = await call(client, "search_pros", { city: "Milan", service: "knotless braids", date: saturday, time_of_day: "morning" });
    const antaAgain = again.body.pros.find((p: Json) => p.pro_handle === "anta.tresses");
    expect(antaAgain?.free_times.map((t: Json) => t.start) ?? []).not.toContain(anta.free_times[0].start);
    expect(again.body.pros[0].pro_handle).toBe("aicha.braids");
  });
});

describe("Book with Kitoko round trip", () => {
  it("search → availability → book_with_deposit → approval_url → booking_status", async () => {
    const client = await connect();

    const search = await call(client, "search_pros", { city: "Milan", service: "knotless braids", max_price: 150 });
    const pro = search.body.pros.find((p: Json) => p.pro_handle === "aicha.braids");
    expect(pro.name).toBe("Aïcha Braids");
    const serviceId: string = pro.service.service_id;

    const saturday = nextSaturday();
    const availability = await call(client, "get_availability", {
      pro_handle: pro.pro_handle,
      service_id: serviceId,
      date_from: saturday,
      date_to: addDays(saturday, 6),
    });
    expect(availability.isError).toBe(false);
    const quote = availability.body.quote;
    expect(quote.currency).toBe("EUR");
    expect(quote.total_now.cents).toBe(quote.deposit_now.cents + quote.booking_fee_now.cents);
    expect(quote.policy.length).toBeGreaterThan(10);
    expect(availability.body.slots.length).toBeGreaterThan(0);
    const slot = availability.body.slots[0];

    const booking = await call(client, "book_with_deposit", {
      pro_handle: pro.pro_handle,
      service_id: serviceId,
      start: slot.start,
      first_name: "Ada",
      email: "ada@example.com",
    });
    expect(booking.isError, JSON.stringify(booking.body)).toBe(false);
    const b = booking.body;
    expect(b.ref).toMatch(/^[A-Z0-9]{6}$/);
    expect(b.status).toBe("held");
    expect(b.service).toBe("Knotless braids");
    expect(b.start).toBe(slot.start);
    expect(b.approval_url).toMatch(/^https?:\/\//);
    expect(b.pay_page_url).toMatch(/\/pay\//);
    expect(b.amounts.total_now.cents).toBe(quote.total_now.cents);
    expect(b.next_step).toContain("you cannot pay on their behalf");
    expect(Date.parse(b.expires_at)).toBeGreaterThan(Date.now());

    const stored = await getBookingByRef(db, b.ref);
    expect(stored?.source).toBe("mcp");
    held.push(stored!.id);
    // One MCP conversation per booking, keyed by the ref, and the tool calls on its timeline.
    const { data: conversation } = await db.from("conversations").select("id, channel, external_id").eq("id", stored!.conversationId!).single();
    expect(conversation).toMatchObject({ channel: "mcp", external_id: b.ref });
    const events = await listAgentEvents(db, { bookingId: stored!.id });
    expect(events.map((e) => e.name)).toContain("mcp.book_with_deposit");
    const logged = events.find((e) => e.name === "mcp.book_with_deposit");
    expect(JSON.stringify(logged?.input)).not.toContain("ada@example.com");

    const status = await call(client, "booking_status", { ref: b.ref.toLowerCase() });
    expect(status.body).toMatchObject({ ref: b.ref, status: "held", paid: false, service: "Knotless braids" });
    expect(JSON.stringify(status.body)).not.toMatch(/Ada|ada@example\.com/);
  });

  it("refuses a hold when the rate limit says no, and an unknown ref", async () => {
    const client = await connect({ allowHold: () => false });
    const refused = await call(client, "book_with_deposit", {
      pro_handle: "aicha.braids",
      service_id: "00000000-0000-4000-8000-000000000000",
      start: new Date(Date.now() + 86_400_000).toISOString(),
      first_name: "Ada",
    });
    expect(refused).toMatchObject({ isError: true, body: { error: "rate_limited" } });
    const unknown = await call(client, "booking_status", { ref: "ZZZZZ9" });
    expect(unknown).toMatchObject({ isError: true, body: { error: "not_found" } });
  });
});

describe("failure cases (docs/qa.md)", () => {
  it("a web chat and an MCP agent hold the same time at once: exactly one wins, the other gets alternatives", async () => {
    const client = await connect();
    const pro = (await getProByHandle(db, "anta.tresses"))!;
    const day = addDays(nextSaturday(), 3); // a Tuesday: she is open, nothing protected
    const availability = await call(client, "get_availability", {
      pro_handle: "anta.tresses",
      service_id: ANTA_CORNROWS,
      date_from: day,
      date_to: day,
    });
    const start: string = availability.body.slots[0].start;

    const ctx = createServicesCtx(process.env);
    const conversation = await getOrCreateConversation(db, { proId: pro.id, kind: "client", channel: "web", locale: "en" });
    webConversations.push(conversation.id);
    const toolCtx: ClientToolCtx = { services: ctx, pro, conversation, source: "web" };
    const tools = new Map(clientTools.map((t) => [t.name, t]));

    const [chat, mcp] = await Promise.all([
      callTool(tools, { id: "race", name: "hold_slot", input: { service_id: ANTA_CORNROWS, start } }, toolCtx),
      call(client, "book_with_deposit", { pro_handle: "anta.tresses", service_id: ANTA_CORNROWS, start, first_name: "Ada" }),
    ]);
    if (!mcp.isError) held.push((await getBookingByRef(db, mcp.body.ref))!.id);
    expect([chat.isError, mcp.isError].toSorted()).toEqual([false, true]);

    if (mcp.isError) {
      expect(["slot_taken", "slot_unavailable"]).toContain(mcp.body.error);
      expect(mcp.body.alternatives.length).toBeGreaterThan(0);
      for (const a of mcp.body.alternatives as Json[]) expect(a.start).not.toBe(start);
    } else {
      const out = chat.output as { error: string; message: string };
      expect(["slot_taken", "slot_unavailable"]).toContain(out.error);
      expect(out.message).toContain("Free times nearby");
    }
  });

  it("book_with_deposit refuses a past start, a malformed start and an unknown handle", async () => {
    const client = await connect();
    const past = await call(client, "book_with_deposit", {
      pro_handle: "anta.tresses",
      service_id: ANTA_CORNROWS,
      start: new Date(Date.now() - 86_400_000).toISOString(),
      first_name: "Ada",
    });
    expect(past).toMatchObject({ isError: true, body: { error: "slot_unavailable" } });
    const malformed = await client.callTool({
      name: "book_with_deposit",
      arguments: { pro_handle: "anta.tresses", service_id: ANTA_CORNROWS, start: "next saturday", first_name: "Ada" },
    });
    expect(malformed.isError).toBe(true);
    const unknown = await call(client, "book_with_deposit", {
      pro_handle: "nobody.here",
      service_id: ANTA_CORNROWS,
      start: new Date(Date.now() + 86_400_000).toISOString(),
      first_name: "Ada",
    });
    expect(unknown).toMatchObject({ isError: true, body: { error: "pro_not_found" } });
  });

  it("PayPal failing on the order releases the hold", async () => {
    // A PayPal client without credentials: every PayPal call fails before the network.
    const broken = createKitokoMcpServer(() => createServicesCtx({ ...process.env, PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "" }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "int-test", version: "1.0.0" });
    await Promise.all([broken.connect(serverSide), client.connect(clientSide)]);
    const day = addDays(nextSaturday(), 4);
    const availability = await call(client, "get_availability", { pro_handle: "anta.tresses", service_id: ANTA_CORNROWS, date_from: day, date_to: day });
    const start: string = availability.body.slots[0].start;
    const r = await call(client, "book_with_deposit", { pro_handle: "anta.tresses", service_id: ANTA_CORNROWS, start, first_name: "Ada" });
    expect(r).toMatchObject({ isError: true, body: { error: "paypal_error" } });
    const { data } = await db.from("bookings").select("id, status, during").eq("pro_id", ANTA).eq("source", "mcp").gte("created_at", startedAt);
    const mine = (data ?? []).filter((b) => Date.parse(String(b.during).slice(2).split(",")[0]!.replace(/"/g, "")) === Date.parse(start));
    held.push(...mine.map((b) => b.id));
    expect(mine.map((b) => b.status)).toEqual(["expired"]);
    // The time is free again.
    const again = await call(client, "get_availability", { pro_handle: "anta.tresses", service_id: ANTA_CORNROWS, date_from: day, date_to: day });
    expect(again.body.slots.map((s: Json) => s.start)).toContain(start);
  });
});
