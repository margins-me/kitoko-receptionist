import { afterAll, describe, expect, it } from "vitest";
import { addDays, localDate, resolveLocal } from "@kitoko/booking";
import { getBooking, getPro, listProMoney, parseRange } from "@kitoko/db";
import { callTool } from "../src/core/tools";
import { blockTime, findSlots, holdSlot, moveTargets, pendingProposal, proposeMove } from "../src/services/booking";
import { earnings, openDepositPage } from "../src/services/payments";
import { clientTools } from "../src/tools/client";
import type { ClientToolCtx } from "../src/tools/client";
import { buildProTools } from "../src/tools/pro";
import { AICHA, DAY, heldBooking, KEMI, KEMI_GEL, newWebConversation, payDeposit, reset, testCtx } from "./fixtures";

// Findings of the production end-to-end run (2026-10-27): earnings by appointment, cancellation preview + confirm.

const ctx = testCtx();
afterAll(async () => {
  await reset(ctx, KEMI);
  await reset(ctx, AICHA);
});

const tools = new Map(clientTools.map((t) => [t.name, t]));
const turn = (byClient = true) => ({ byClient, previewed: new Set<string>() });

describe("earnings count the appointments in the range", () => {
  it("this week's seeded bookings count, although their deposits were captured days before (SEED- captures)", async () => {
    await reset(ctx, AICHA);
    const tz = "Europe/Rome";
    const today = localDate(Date.now(), tz);
    const from = resolveLocal(today, "00:00", tz).at;
    const to = resolveLocal(addDays(today, 7), "00:00", tz).at;

    // The expectation straight from the rows: bookings starting in [from, to) with a captured deposit.
    const { data } = await ctx.db.from("bookings").select("id, during, payments (status, amount_cents, fee_cents, captured_at)").eq("pro_id", AICHA);
    const inRange = (data ?? []).filter((b) => {
      const start = parseRange(String(b.during)).start;
      return start >= from && start < to;
    });
    const paid = inRange.flatMap((b) => b.payments.filter((p) => p.status === "captured" || p.status === "refunded").map((p) => ({ ...p, bookingId: b.id })));
    expect(new Set(paid.map((p) => p.bookingId)).size).toBeGreaterThanOrEqual(5);
    // Captured before the range starts: the old creation-time filter missed every one of these.
    expect(paid.every((p) => Date.parse(p.captured_at!) < from)).toBe(true);

    const e = await earnings(ctx, { proId: AICHA, from, to });
    if (!e.ok) throw new Error(e.error);
    expect(e.value.bookings).toBe(new Set(paid.map((p) => p.bookingId)).size);
    expect(e.value.capturedCents).toBe(paid.reduce((s, p) => s + p.amount_cents, 0));
    expect(e.value.feesCents).toBe(paid.reduce((s, p) => s + p.fee_cents, 0));

    // A booking outside the range does not leak in through its payment's creation date.
    const money = await listProMoney(ctx.db, AICHA, { from, to });
    const ids = new Set(inRange.map((b) => b.id));
    for (const row of [...money.payments, ...money.refunds, ...money.payouts]) expect(ids.has(row.bookingId)).toBe(true);
  });

  it("the pro tool reports the appointment range and keeps PayPal Reporting as a separate best-effort part", async () => {
    const pro = (await getPro(ctx.db, AICHA))!;
    const { data: conv } = await ctx.db.from("conversations").select("*").eq("pro_id", AICHA).eq("kind", "pro").limit(1).maybeSingle();
    const proTools = new Map(buildProTools({}).map((t) => [t.name, t]));
    const today = localDate(Date.now(), pro.timezone);
    const r = await callTool(
      proTools,
      { id: "e1", name: "earnings", input: { date_from: today, date_to: addDays(today, 6) } },
      { services: ctx, pro, conversation: conv as never, actions: [] },
    );
    expect(r.isError).toBe(false);
    const out = r.output as Record<string, unknown>;
    expect(out.bookings_paid).toBeGreaterThanOrEqual(5);
    expect(out).toHaveProperty("appointments_from");
    expect(out).toHaveProperty("paypal_reporting_best_effort");
  });
});

describe("block_time tells the pro the clients' refunds are automatic", () => {
  it("never says she has to confirm a displaced client's refund", () => {
    const blockTool = buildProTools({}).find((t) => t.name === "block_time")!;
    expect(blockTool.description).toContain("the client's choice is carried out at once (a move, or the refund through PayPal), without her confirmation");
  });
});

describe("a client's cancellation is previewed, then confirmed in a later message", () => {
  it("confirm false changes nothing; confirm true in the same run is refused; the next client message cancels", async () => {
    const { conversation, held } = await heldBooking(ctx, 20);
    await payDeposit(ctx, held.bookingId);
    const pro = (await getPro(ctx.db, KEMI))!;
    const first: ClientToolCtx = { services: ctx, pro, conversation, source: "web", turn: turn() };

    const preview = await callTool(tools, { id: "c1", name: "cancel_booking", input: { booking_id: held.ref } }, first);
    expect(preview.output).toMatchObject({ status: "not_cancelled_yet", if_cancelled: { refunded: "£30", deposit_kept: "£0", booking_fee_kept: "£1.50" } });
    expect((await getBooking(ctx.db, held.bookingId))?.status).toBe("confirmed");

    // The model jumping ahead in the same reply: still a preview.
    const sameRun = await callTool(tools, { id: "c2", name: "cancel_booking", input: { booking_id: held.ref, confirm: true } }, first);
    expect(sameRun.output).toMatchObject({ status: "not_cancelled_yet" });
    expect((await getBooking(ctx.db, held.bookingId))?.status).toBe("confirmed");

    // A system [event] run is not her answer.
    const eventRun = await callTool(tools, { id: "c3", name: "cancel_booking", input: { booking_id: held.ref, confirm: true } }, { ...first, turn: turn(false) });
    expect(eventRun.output).toMatchObject({ status: "not_cancelled_yet" });

    // Her "yes" in the next message.
    const yes = await callTool(tools, { id: "c4", name: "cancel_booking", input: { booking_id: held.ref, confirm: true } }, { ...first, turn: turn() });
    expect(yes.output).toMatchObject({ status: "cancelled", refunded: "£30", deposit_kept: "£0", booking_fee_kept: "£1.50", refund_status: "succeeded" });
    expect((await getBooking(ctx.db, held.bookingId))?.status).toBe("cancelled");
  });

  it("confirm true without any earlier preview only previews", async () => {
    const { conversation, held } = await heldBooking(ctx, 23);
    await payDeposit(ctx, held.bookingId);
    const pro = (await getPro(ctx.db, KEMI))!;
    const r = await callTool(tools, { id: "d1", name: "cancel_booking", input: { booking_id: held.bookingId, confirm: true } }, { services: ctx, pro, conversation, source: "web", turn: turn() });
    expect(r.output).toMatchObject({ status: "not_cancelled_yet" });
    expect((await getBooking(ctx.db, held.bookingId))?.status).toBe("confirmed");
  });

  it("a displaced booking (the pro could not keep it) is refunded in full at once", async () => {
    const { conversation, held } = await heldBooking(ctx, 26);
    await payDeposit(ctx, held.bookingId);
    const blocked = await blockTime(ctx, { proId: KEMI, from: Date.parse(held.start), to: Date.parse(held.end), label: "Sick" });
    expect(blocked.ok && blocked.value.displaced).toContain(held.bookingId);
    const pro = (await getPro(ctx.db, KEMI))!;
    const r = await callTool(tools, { id: "x1", name: "cancel_booking", input: { booking_id: held.ref } }, { services: ctx, pro, conversation, source: "web", turn: turn() });
    expect(r.output).toMatchObject({ status: "cancelled", refunded: "£31.50", booking_fee_kept: "£0" });
  });
});

describe("hold length by channel, and one refresh when the deposit page opens", () => {
  it("web 15 min, WhatsApp and MCP 30 min; the first page open tops a short hold up to 15 min, once, never shorter", async () => {
    const from = Date.now() + 30 * DAY;
    const slots = await findSlots(ctx, { proId: KEMI, serviceId: KEMI_GEL, from, to: from + 7 * DAY });
    if (!slots.ok) throw new Error(slots.error);
    // Three slots that do not overlap each other.
    const picked: { start: string; end: string }[] = [];
    for (const slot of slots.value) if (!picked.length || Date.parse(slot.start) >= Date.parse(picked.at(-1)!.end)) picked.push(slot);
    const [web, wa, mcp] = picked;
    const hold = async (start: string, source: "web" | "whatsapp" | "mcp") => {
      const conversation = await newWebConversation(ctx, KEMI);
      const h = await holdSlot(ctx, { proId: KEMI, serviceId: KEMI_GEL, start, source, conversationId: conversation.id, locale: "en" });
      if (!h.ok) throw new Error(h.error);
      return h.value;
    };
    const minutesLeft = (at: string | number) => Math.round((new Date(at).getTime() - Date.now()) / 60_000);
    const w = await hold(web!.start, "web");
    expect(minutesLeft(w.holdExpiresAt)).toBe(15);
    expect(minutesLeft((await hold(wa!.start, "whatsapp")).holdExpiresAt)).toBe(30);
    const m = await hold(mcp!.start, "mcp");
    expect(minutesLeft(m.holdExpiresAt)).toBe(30);

    await ctx.db.from("bookings").update({ hold_expires_at: new Date(Date.now() + 2 * 60_000).toISOString() }).eq("id", w.bookingId);
    const opened = await openDepositPage(ctx, { bookingId: w.bookingId });
    expect(opened.ok && minutesLeft(opened.value!)).toBe(15);
    await ctx.db.from("bookings").update({ hold_expires_at: new Date(Date.now() + 2 * 60_000).toISOString() }).eq("id", w.bookingId);
    const again = await openDepositPage(ctx, { bookingId: w.bookingId });
    expect(again.ok && minutesLeft(again.value!)).toBe(2);
    const longer = await openDepositPage(ctx, { bookingId: m.bookingId });
    expect(longer.ok && minutesLeft(longer.value!)).toBe(30);
  });
});

describe("calendar drag: the client's yes moves the booking, her no is recorded", () => {
  it("yes: reschedule_booking to exactly the proposed start (by the pro); no: booking unchanged, decline recorded", async () => {
    const pro = (await getPro(ctx.db, KEMI))!;
    for (const answer of ["yes", "no"] as const) {
      const { conversation, held } = await heldBooking(ctx, answer === "yes" ? 40 : 44);
      await payDeposit(ctx, held.bookingId);
      const targets = await moveTargets(ctx, { bookingId: held.bookingId, from: Date.parse(held.start) + DAY, to: Date.parse(held.start) + 3 * DAY });
      if (!targets.ok || !targets.value[0]) throw new Error("no target");
      const target = targets.value[0].start;
      const proposed = await proposeMove(ctx, { bookingId: held.bookingId, start: target });
      expect(proposed.ok).toBe(true);
      expect(await pendingProposal(ctx, held.bookingId)).toBe(Date.parse(target));
      const toolCtx: ClientToolCtx = { services: ctx, pro, conversation, source: "web", turn: turn() };
      if (answer === "yes") {
        const r = await callTool(tools, { id: "y1", name: "reschedule_booking", input: { booking_id: held.ref, start: target } }, toolCtx);
        expect(r.output).toMatchObject({ status: "confirmed", start: target });
        const after = await getBooking(ctx.db, held.bookingId);
        expect(after?.start).toBe(Date.parse(target));
        expect(after?.rescheduleCount).toBe(0);
      } else {
        const r = await callTool(tools, { id: "n1", name: "decline_proposed_move", input: { booking_id: held.ref } }, toolCtx);
        expect(r.output).toMatchObject({ booking_ref: held.ref, status: "confirmed" });
        expect((await getBooking(ctx.db, held.bookingId))?.start).toBe(Date.parse(held.start));
        expect(await pendingProposal(ctx, held.bookingId)).toBeNull();
        const { data } = await ctx.db.from("agent_events").select("name").eq("booking_id", held.bookingId).eq("name", "reschedule_declined");
        expect(data).toHaveLength(1);
        // Nothing left to decline.
        const again = await callTool(tools, { id: "n2", name: "decline_proposed_move", input: { booking_id: held.ref } }, toolCtx);
        expect(again.output).toMatchObject({ error: "no_proposal" });
      }
    }
  });
});
