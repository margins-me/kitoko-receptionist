import { addDays, localDate } from "@kitoko/booking";
import { describe, expect, it } from "vitest";
import { getConversationByToken, listBookings, listMessages, resetDemo } from "../src";
import { AICHA, KEMI, NALA, proClient, svc } from "./fixtures";

const ROME = "Europe/Rome";
const DAY = 86_400_000;

describe("the demo week", () => {
  it("resets Aïcha's week, the same twice in a row", async () => {
    const db = svc();
    expect(await resetDemo(db, AICHA)).toEqual({ ok: true, value: undefined });
    const now = Date.now();
    const first = await listBookings(db, AICHA, now - 2 * DAY, now + 8 * DAY, { statuses: ["held", "confirmed", "honoured", "cancelled"] });
    expect(await resetDemo(db, AICHA)).toEqual({ ok: true, value: undefined });
    const second = await listBookings(db, AICHA, now - 2 * DAY, now + 8 * DAY, { statuses: ["held", "confirmed", "honoured", "cancelled"] });
    const shape = (list: typeof first) => list.map((b) => [b.start, b.status, b.service.name, b.client?.firstName ?? null, b.money.paidCents]);
    expect(shape(second)).toEqual(shape(first));
    expect(second.length).toBe(11);

    const cascadeDay = addDays(localDate(now, ROME), 3);
    const cascade = second.filter((b) => localDate(b.start, ROME) === cascadeDay);
    expect(cascade.map((b) => [b.status, b.conversationToken, b.money.paidCents, b.money.captureId?.startsWith("SEED-")])).toEqual([
      ["confirmed", "demo-aicha-client-1", 3150, true],
      ["confirmed", "demo-aicha-client-2", 3150, true],
      ["confirmed", "demo-aicha-client-3", 3150, true],
    ]);
    expect(second.filter((b) => b.status === "held")).toHaveLength(1);
    expect(second.find((b) => b.status === "cancelled")?.money).toMatchObject({ refundedCents: 3000, refundPending: false });
    expect(second.find((b) => b.status === "honoured")?.money).toMatchObject({ payoutCents: 3000, payoutStatus: "pending" });

    const chat = (await getConversationByToken(db, "demo-aicha-client-1"))!;
    expect(chat).toMatchObject({ proId: AICHA, channel: "web", kind: "client", locale: "it" });
    const messages = await listMessages(db, chat.id, { visibleOnly: true });
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(messages[1]!.content)).toContain(cascade[0]!.ref);
  });

  it("lets the pro reset her own demo only, and read only her own bookings", async () => {
    const aicha = await proClient("aicha@demo.kitoko.page");
    expect(await resetDemo(aicha, AICHA)).toEqual({ ok: true, value: undefined });
    expect(await resetDemo(aicha, KEMI)).toEqual({ ok: false, error: "forbidden" });
    const now = Date.now();
    expect((await listBookings(aicha, AICHA, now - 2 * DAY, now + 8 * DAY)).length).toBeGreaterThan(0);
    expect(await listBookings(aicha, NALA, now - 2 * DAY, now + 8 * DAY)).toEqual([]);
  });
});
