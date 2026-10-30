import { afterAll, describe, expect, it } from "vitest";
import { getBooking, getOrCreateConversation, getPendingAction, getPro } from "@kitoko/db";
import type { PendingAction } from "@kitoko/db";
import { callTool } from "../src/core/tools";
import { decideAction, requestAction } from "../src/services/actions";
import { handleMessage } from "../src/services/conversation";
import { buildProTools } from "../src/tools/pro";
import type { ProToolCtx } from "../src/tools/pro";
import { AICHA, fakePayPal, heldBooking, KEMI, payDeposit, reset, testCtx } from "./fixtures";

const ctx = testCtx();
afterAll(() => reset(ctx, KEMI));

const moneyCalls = () => fakePayPal().requests.filter((r) => r.method === "POST" && /\/refund$|\/v1\/payments\/payouts$|\/v2\/invoicing\/invoices/.test(r.path)).length;

async function proToolCtx(): Promise<ProToolCtx> {
  const pro = (await getPro(ctx.db, KEMI))!;
  const conversation = await getOrCreateConversation(ctx.db, { proId: KEMI, kind: "pro", channel: "web", externalId: "dashboard" });
  return { services: ctx, pro, conversation, actions: [] };
}

describe("pending actions: decideAction is the only path that moves money", () => {
  it("refund_deposit prepares; only the confirmed decision refunds", async () => {
    const { held } = await heldBooking(ctx, 26);
    await payDeposit(ctx, held.bookingId);
    const tc = await proToolCtx();
    const tools = new Map(buildProTools(ctx.env).map((t) => [t.name, t]));
    const before = moneyCalls();

    const asked = await callTool(tools, { id: "p1", name: "refund_deposit", input: { booking: held.ref } }, tc);
    expect(asked.isError).toBe(false);
    expect(asked.output).toMatchObject({ status: "waiting_for_her_confirmation" });
    const action = tc.actions[0]!;
    expect(action).toMatchObject({ kind: "refund", amountCents: 3150, status: "pending" });

    // Nothing moved: no PayPal money call, booking still confirmed, no refund row.
    expect(moneyCalls()).toBe(before);
    let b = await getBooking(ctx.db, held.bookingId);
    expect(b?.status).toBe("confirmed");
    expect(b?.refunds).toEqual([]);

    // Another pro cannot decide it.
    const stranger = await decideAction(ctx, { actionId: action.id, decision: "confirmed", proId: AICHA });
    expect(stranger).toEqual({ ok: false, error: "not_found" });
    expect((await getPendingAction(ctx.db, action.id))?.status).toBe("pending");

    const decided = await decideAction(ctx, { actionId: action.id, decision: "confirmed", proId: KEMI });
    expect(decided.ok).toBe(true);
    b = await getBooking(ctx.db, held.bookingId);
    expect(b?.status).toBe("cancelled");
    expect(b?.refunds.map((r) => [r.amountCents, r.status])).toEqual([[3150, "succeeded"]]);
    expect(moneyCalls()).toBe(before + 1);

    // Once only.
    expect(await decideAction(ctx, { actionId: action.id, decision: "confirmed", proId: KEMI })).toEqual({ ok: false, error: "not_pending" });
  });

  it("a cancelled decision moves nothing", async () => {
    const { held } = await heldBooking(ctx, 27);
    await payDeposit(ctx, held.bookingId);
    const action = await requestAction(ctx, { proId: KEMI, kind: "refund", bookingId: held.bookingId });
    if (!action.ok) throw new Error(action.error);
    const before = moneyCalls();
    const decided = await decideAction(ctx, { actionId: action.value.id, decision: "cancelled", proId: KEMI });
    expect(decided.ok && decided.value.action.status).toBe("cancelled");
    expect(moneyCalls()).toBe(before);
    expect((await getBooking(ctx.db, held.bookingId))?.status).toBe("confirmed");
  });

  it("mark_done prepares a payout; a WhatsApp button reply from the pro confirms it without the model", async () => {
    const { held } = await heldBooking(ctx, 28);
    await payDeposit(ctx, held.bookingId);
    const tc = await proToolCtx();
    const tools = new Map(buildProTools(ctx.env).map((t) => [t.name, t]));
    await callTool(tools, { id: "p2", name: "mark_done", input: { booking: held.bookingId, outcome: "honoured" } }, tc);
    const action: PendingAction = tc.actions[0]!;
    expect(action).toMatchObject({ kind: "payout", amountCents: 3000 });
    expect((await getBooking(ctx.db, held.bookingId))?.payouts).toEqual([]);

    const r = await handleMessage(ctx, {
      channel: "whatsapp",
      externalId: "+440000000002",
      kind: "pro",
      proId: KEMI,
      text: "Confirm",
      buttonId: `action:${action.id}:confirm`,
    });
    expect(r.ok).toBe(true);
    const b = await getBooking(ctx.db, held.bookingId);
    expect(b?.status).toBe("honoured");
    expect(b?.payouts[0]?.amountCents).toBe(3000);
    expect(ctx.sent.at(-1)).toMatchObject({ channel: "whatsapp", to: "+440000000002" });
    // The model never ran: no model turn was logged for that conversation.
    const { data: turns } = await ctx.db.from("agent_events").select("id").eq("conversation_id", r.ok ? r.value.conversationId : "").eq("kind", "model");
    expect(turns).toEqual([]);
  });
});
