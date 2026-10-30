import { afterAll, describe, expect, it } from "vitest";
import { getBooking, listConversationBookings } from "@kitoko/db";
import { callTool } from "../src/core/tools";
import { cancelBooking, findSlots, markDone, quoteService } from "../src/services/booking";
import { handleMessage } from "../src/services/conversation";
import { capturePayment } from "../src/services/payments";
import { clientTools } from "../src/tools/client";
import type { ClientToolCtx } from "../src/tools/client";
import { getPro } from "@kitoko/db";
import { DAY, heldBooking as heldBookingIn, KEMI, KEMI_GEL, payDeposit as payDepositIn, reset, testCtx, texts } from "./fixtures";

const ctx = testCtx();
afterAll(() => reset(ctx, KEMI));

const heldBooking = (days: number) => heldBookingIn(ctx, days);
const payDeposit = (bookingId: string) => payDepositIn(ctx, bookingId);

describe("booking and money flow (fake PayPal, fake model)", () => {
  it("quotes with amounts from @kitoko/booking and caps the slots", async () => {
    const q = await quoteService(ctx, { proId: KEMI, serviceId: KEMI_GEL, locale: "en" });
    expect(q.ok && q.value).toMatchObject({ priceCents: 5600, minutes: 120, depositCents: 3000, feeCents: 150, totalNowCents: 3150, currency: "GBP" });
    const slots = await findSlots(ctx, { proId: KEMI, serviceId: KEMI_GEL, from: Date.now(), to: Date.now() + 14 * DAY });
    expect(slots.ok && slots.value.length).toBe(20);
  });

  it("hold → deposit link → approve → capture → confirmed, event appended; cancel refunds per policy", async () => {
    const { conversation, held } = await heldBooking(20);
    expect(held).toMatchObject({ depositCents: 3000, feeCents: 150, currency: "GBP", staffName: "Kemi" });

    const { link, captured } = await payDeposit(held.bookingId);
    expect(link.payUrl).toBe(`http://localhost:3300/pay/${held.bookingId}`);
    expect(link.amountCents).toBe(3150);
    expect(captured.outcome).toBe("confirmed");

    const booking = await getBooking(ctx.db, held.bookingId);
    expect(booking?.status).toBe("confirmed");
    expect(booking?.client?.firstName).toBe("Tolu");

    const msgs = await texts(ctx, conversation.id);
    expect(msgs[0]).toMatchObject({ role: "user", visible: false });
    expect(msgs[0]!.content).toContain("[event] payment_captured");
    expect(msgs[1]).toMatchObject({ role: "assistant", visible: true });

    // Idempotent: a second capture (webhook backstop) changes nothing and sends no second message.
    const again = await capturePayment(ctx, { orderId: link.orderId! });
    expect(again.ok && again.value.outcome).toBe("already_captured");
    expect((await texts(ctx, conversation.id)).length).toBe(2);

    // 20 days out: inside the free window, the deposit is refunded and the booking fee kept.
    const cancelled = await cancelBooking(ctx, { bookingId: held.bookingId, by: "client" });
    expect(cancelled.ok && cancelled.value).toMatchObject({ refundCents: 3000, keptCents: 0, feeKeptCents: 150, refundStatus: "succeeded" });
    const after = await getBooking(ctx.db, held.bookingId);
    expect(after?.status).toBe("cancelled");
    expect(after?.refunds.map((r) => [r.amountCents, r.status])).toEqual([[3000, "succeeded"]]);
  });

  it("markDone pays the deposit out through PayPal Payouts", async () => {
    const { held } = await heldBooking(22);
    await payDeposit(held.bookingId);
    const done = await markDone(ctx, { bookingId: held.bookingId, outcome: "honoured" });
    expect(done.ok && done.value).toMatchObject({ outcome: "honoured", payoutCents: 3000 });
    const b = await getBooking(ctx.db, held.bookingId);
    expect(b?.payouts[0]).toMatchObject({ amountCents: 3000, reason: "honoured" });
    expect(["sent", "succeeded"]).toContain(b?.payouts[0]?.status);
    expect(b?.payouts[0]?.payoutBatchId).toBeTruthy();
  });

  it("client tools only see their own conversation's bookings", async () => {
    const a = await heldBooking(24);
    const b = await heldBooking(25);
    const pro = (await getPro(ctx.db, KEMI))!;
    const toolCtx: ClientToolCtx = { services: ctx, pro, conversation: a.conversation, source: "web" };
    const tools = new Map(clientTools.map((t) => [t.name, t]));
    const other = await callTool(tools, { id: "t1", name: "create_deposit_link", input: { booking_id: b.held.bookingId } }, toolCtx);
    expect(other.isError).toBe(true);
    expect(other.output).toMatchObject({ error: "not_found" });
    const cancel = await callTool(tools, { id: "t2", name: "cancel_booking", input: { booking_id: b.held.ref } }, toolCtx);
    expect(cancel.output).toMatchObject({ error: "not_found" });
    const mine = await callTool(tools, { id: "t3", name: "list_my_bookings", input: {} }, toolCtx);
    expect((mine.output as { bookings: { ref: string }[] }).bookings.map((x) => x.ref)).toEqual([a.held.ref]);
  });

  it("handleMessage runs the client agent with real tools to a deposit link (rule-based fake model)", async () => {
    const events: string[] = [];
    const r = await handleMessage(ctx, {
      channel: "web",
      kind: "client",
      proHandle: "kemi.nails",
      text: "I'd like to book please",
      locale: "en",
      onEvent: (e) => void events.push(e.type === "tool_result" ? `${e.name}:${e.isError ? "error" : "ok"}` : e.type),
    });
    if (!r.ok) throw new Error(r.error);
    expect(events[0]).toBe("conversation");
    expect(events.filter((e) => e.includes(":"))).toEqual(["list_services:ok", "get_availability:ok", "hold_slot:ok", "create_deposit_link:ok"]);
    expect(r.value.text).toContain("/pay/");
    const bookings = await listConversationBookings(ctx.db, r.value.conversationId);
    expect(bookings.map((b) => b.status)).toEqual(["held"]);
    expect(bookings[0]!.payments.map((p) => p.status)).toEqual(["created"]);
    const { data: logged } = await ctx.db.from("agent_events").select("name, kind, booking_id").eq("conversation_id", r.value.conversationId).eq("kind", "tool").order("id");
    expect(logged?.map((e) => e.name)).toEqual(["list_services", "get_availability", "hold_slot", "create_deposit_link"]);
    expect(logged?.find((e) => e.name === "hold_slot")?.booking_id).toBe(bookings[0]!.id);
  });
});
