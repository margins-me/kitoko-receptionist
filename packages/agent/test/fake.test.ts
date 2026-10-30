import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ok } from "@kitoko/booking/result";
import { runAgent } from "../src/core/run";
import { defineTool, toolError } from "../src/core/tools";
import { createFakeModel, findValue } from "../src/model/fake";
import { createModel } from "../src/model/index";

const tool = defineTool<null>();
const system = { base: "b", context: "c" };
const bookingTools = [
  tool({ name: "list_services", description: "", input: z.object({}), run: async () => ok({ services: [{ id: "svc_1", name: "Knotless" }] }) }),
  tool({
    name: "get_availability",
    description: "",
    input: z.object({ service_id: z.string() }),
    run: async (i) => ok({ slots: [{ start: "2026-10-30T10:00", service: i.service_id }] }),
  }),
  tool({
    name: "hold_slot",
    description: "",
    input: z.object({ service_id: z.string(), start: z.string() }),
    run: async (i) => ok({ booking_id: "bk_1", start: i.start, hold_minutes: 15 }),
  }),
  tool({
    name: "create_deposit_link",
    description: "",
    input: z.object({ booking_id: z.string() }),
    run: async () => ok({ url: "http://localhost:3300/pay/bk_1", deposit_cents: 3000, fee_cents: 150 }),
  }),
];

describe("scripted fake", () => {
  it("replays its script and records requests", async () => {
    const model = createFakeModel([{ text: "one" }, (req) => ({ text: `saw ${req.messages.length} messages` })]);
    expect((await model.respond({ system, tools: [], messages: [{ role: "user", content: "a" }] })).content).toEqual([{ type: "text", text: "one" }]);
    expect((await model.respond({ system, tools: [], messages: [{ role: "user", content: "b" }, { role: "user", content: "c" }] })).content).toEqual([
      { type: "text", text: "saw 2 messages" },
    ]);
    expect(model.requests).toHaveLength(2);
    await expect(model.respond({ system, tools: [], messages: [] })).rejects.toThrow(/used up/);
  });
});

describe("rule-based dev fake (AGENT_FAKE=1)", () => {
  const model = createModel({ AGENT_FAKE: "1" });

  it("is what createModel returns with AGENT_FAKE=1", () => {
    expect(model.id).toBe("fake-rule-based");
  });

  it("walks the canned booking path and echoes the results", async () => {
    const res = await runAgent({ model, system, tools: bookingTools, history: [], input: "I'd like to book braids", ctx: null });
    const calls = res.newMessages.flatMap((m) => (typeof m.content === "string" ? [] : m.content.flatMap((b) => (b.type === "tool_use" ? [[b.name, b.input]] : []))));
    expect(calls).toEqual([
      ["list_services", {}],
      ["get_availability", { service_id: "svc_1" }],
      ["hold_slot", { service_id: "svc_1", start: "2026-10-30T10:00" }],
      ["create_deposit_link", { booking_id: "bk_1" }],
    ]);
    expect(res.status).toBe("done");
    expect(res.text).toMatch(/^\(dev fake, no AI\) Here is what the tools returned:/);
    expect(res.text).toContain("http://localhost:3300/pay/bk_1");
  });

  it("explains itself when the message is not a booking request, in any language trigger", async () => {
    const res = await runAgent({ model, system, tools: bookingTools, history: [], input: "hello", ctx: null });
    expect(res.text).toBe('(dev fake, no AI) I only follow a scripted booking path. Write "book" to try it.');
    const fr = await runAgent({ model, system, tools: bookingTools, history: [], input: "Je voudrais réserver", ctx: null });
    expect(fr.newMessages[1]?.content).toMatchObject([{ type: "tool_use", name: "list_services" }]);
  });

  it("acknowledges system events and stops on a tool error", async () => {
    const event = await runAgent({ model, system, tools: bookingTools, history: [], input: '[event] payment_captured {"ref":"K7X2PQ"}', ctx: null });
    expect(event.text).toBe('(dev fake, no AI) System event received: payment_captured {"ref":"K7X2PQ"}');

    const failing = [bookingTools[0]!, tool({ name: "get_availability", description: "", input: z.object({ service_id: z.string() }), run: async () => toolError("closed") })];
    const res = await runAgent({ model, system, tools: failing, history: [], input: "book", ctx: null });
    expect(res.text).toBe('(dev fake, no AI) get_availability failed: {"error":"closed"}');
  });
});

describe("findValue", () => {
  it("finds the first value under one of the keys, depth-first", () => {
    expect(findValue({ a: { list: [{ x: 1 }, { id: "deep" }] }, id: "top" }, ["id"])).toBe("top");
    expect(findValue({ a: { list: [{ x: 1 }, { id: "deep" }] } }, ["id"])).toBe("deep");
    expect(findValue([null, "x"], ["id"])).toBeUndefined();
  });
});
