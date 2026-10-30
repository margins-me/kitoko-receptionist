import { afterAll, describe, expect, it } from "vitest";
import { addDays, localDate, resolveLocal } from "@kitoko/booking";
import { getBooking, getConversationByToken, listConversationBookings, listMessages } from "@kitoko/db";
import { blockTime } from "../src/services/booking";
import { AICHA, reset, testCtx } from "./fixtures";

const ctx = testCtx();
afterAll(() => reset(ctx, AICHA));

describe("sick day cascade", () => {
  it("blockTime displaces Aïcha's 3 seeded bookings and messages each client with 3 real free times", async () => {
    await reset(ctx, AICHA);
    const tz = "Europe/Rome";
    // today + 3, or today + 4 when today + 3 is next Saturday (supabase/migrations/20261027000700_demo_within_hours.sql)
    const first = (await getConversationByToken(ctx.db, "demo-aicha-client-1"))!;
    const [seeded] = await listConversationBookings(ctx.db, first.id);
    const day = localDate(seeded!.start, tz);
    expect([addDays(localDate(Date.now(), tz), 3), addDays(localDate(Date.now(), tz), 4)]).toContain(day);
    const from = resolveLocal(day, "00:00", tz).at;
    const to = resolveLocal(addDays(day, 1), "00:00", tz).at;

    const r = await blockTime(ctx, { proId: AICHA, from, to, label: "Malata" });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.displaced).toHaveLength(3);

    for (const token of ["demo-aicha-client-1", "demo-aicha-client-2", "demo-aicha-client-3"]) {
      const conversation = (await getConversationByToken(ctx.db, token))!;
      const messages = await listMessages(ctx.db, conversation.id);
      const event = messages.find((m) => !m.visible && JSON.stringify(m.content).includes("[event] booking_displaced"));
      expect(event, token).toBeTruthy();
      const payload = JSON.parse(JSON.stringify(event!.content).match(/booking_displaced (\{.*\})"/)![1]!.replace(/\\"/g, '"')) as {
        alternatives: { start: string }[];
        booking_id: string;
      };
      expect(payload.alternatives).toHaveLength(3);
      for (const a of payload.alternatives) expect(Date.parse(a.start) < from || Date.parse(a.start) >= to).toBe(true);
      expect(messages.at(-1)).toMatchObject({ role: "assistant", visible: true });
      expect((await getBooking(ctx.db, payload.booking_id))?.displacedAt).not.toBeNull();
    }
  });
});
