import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ok } from "@kitoko/booking/result";
import { runAgent } from "../src/core/run";
import type { AgentEvent } from "../src/core/run";
import { systemEvent } from "../src/core/system-events";
import { defineTool, toolError } from "../src/core/tools";
import { createFakeModel } from "../src/model/fake";
import type { AgentMessage } from "../src/model/types";
import { ModelError } from "../src/model/types";

type Ctx = { conversationId: string };
const tool = defineTool<Ctx>();
const system = { base: "You are a receptionist.", context: "Now: Tuesday 27 October 2026 at 14:05." };
const ctx = { conversationId: "conv_1" };

const listServices = tool({
  name: "list_services",
  description: "Lists services.",
  input: z.object({}),
  run: async () => ok({ services: [{ id: "svc_1", name: "Knotless braids", price_cents: 12000 }] }),
});
const getAvailability = tool({
  name: "get_availability",
  description: "Free times.",
  input: z.object({ service_id: z.string() }),
  run: async (input) => ok({ service_id: input.service_id, slots: ["2026-10-30T10:00"] }),
});
const holdSlot = tool({
  name: "hold_slot",
  description: "Holds a slot.",
  input: z.object({ service_id: z.string(), start: z.string() }),
  run: async () => toolError("slot_taken", "That time was just taken; offer another."),
});
const tools = [listServices, getAvailability, holdSlot];

const collect = () => {
  const events: AgentEvent[] = [];
  return { events, onEvent: (e: AgentEvent) => void events.push(e), types: () => events.filter((e) => e.type !== "text_delta").map((e) => e.type) };
};

describe("runAgent", () => {
  it("answers without tools and streams the text", async () => {
    const model = createFakeModel([{ text: "Hello! How can I help?" }]);
    const { events, onEvent } = collect();
    const res = await runAgent({ model, system, tools, history: [], input: "Hi", ctx, onEvent });
    expect(res).toEqual({
      newMessages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Hello! How can I help?" }] },
      ],
      text: "Hello! How can I help?",
      status: "done",
    });
    const deltas = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : []));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe("Hello! How can I help?");
    expect(model.requests[0]).toMatchObject({ system, messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] });
    expect(model.requests[0]?.tools.map((t) => t.name)).toEqual(["list_services", "get_availability", "hold_slot"]);
  });

  it("ends the run after a final tool, without asking the model again, and the next turn stays valid", async () => {
    const offer = tool({ name: "offer_choices", description: "Buttons.", input: z.object({ choices: z.array(z.string()) }), run: async (i) => ok(i), final: true });
    const model = createFakeModel([{ text: "Friday 10:00 or 13:00?", tools: [{ id: "tu_c", name: "offer_choices", input: { choices: ["10:00", "13:00"] } }] }, { text: "Held." }]);
    const res = await runAgent({ model, system, tools: [...tools, offer], history: [], input: "Friday?", ctx });
    expect(res.status).toBe("done");
    expect(res.text).toBe("Friday 10:00 or 13:00?");
    expect(model.requests).toHaveLength(1);
    // The client's next message follows the tool result: sent as one user message, results first.
    await runAgent({ model, system, tools: [...tools, offer], history: res.newMessages, input: "13:00", ctx });
    expect(model.requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_c", content: '{"choices":["10:00","13:00"]}' },
        { type: "text", text: "13:00" },
      ],
    });
  });

  it("runs the tool loop and returns the messages to store, in API shape", async () => {
    const model = createFakeModel([
      { tools: [{ id: "tu_1", name: "list_services" }] },
      { tools: [{ id: "tu_2", name: "get_availability", input: { service_id: "svc_1" } }] },
      { text: "Friday 30 October at 10:00 is free. Shall I hold it?" },
    ]);
    const { events, onEvent, types } = collect();
    const res = await runAgent({ model, system, tools, history: [], input: "Braids on Friday?", ctx, onEvent });

    expect(res.status).toBe("done");
    expect(res.newMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "Braids on Friday?" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "list_services", input: {} }] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"services":[{"id":"svc_1","name":"Knotless braids","price_cents":12000}]}' }],
      },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_2", name: "get_availability", input: { service_id: "svc_1" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_2", content: '{"service_id":"svc_1","slots":["2026-10-30T10:00"]}' }] },
      { role: "assistant", content: [{ type: "text", text: "Friday 30 October at 10:00 is free. Shall I hold it?" }] },
    ]);
    expect(types()).toEqual(["message_complete", "tool_call", "tool_result", "message_complete", "tool_call", "tool_result", "message_complete"]);
    expect(events.find((e) => e.type === "tool_call")).toEqual({ type: "tool_call", id: "tu_1", name: "list_services", input: {} });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ id: "tu_1", name: "list_services", isError: false, output: { services: [{ id: "svc_1" }] } });
    // Each call sends the whole conversation so far: the third one ends with the second tool result.
    expect(model.requests).toHaveLength(3);
    expect(model.requests[2]?.messages).toEqual(res.newMessages.slice(0, 5));
  });

  it("runs parallel tool calls together and returns all results in one user message", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = tool({ name: "slow", description: "", input: z.object({}), run: async () => (await gate, ok("slow done")) });
    const fast = tool({ name: "fast", description: "", input: z.object({}), run: async () => (release(), ok("fast done")) });
    const model = createFakeModel([
      { tools: [{ id: "a", name: "slow" }, { id: "b", name: "fast" }] },
      { text: "Both done." },
    ]);
    // slow only finishes once fast has started: sequential execution would hang here.
    const res = await runAgent({ model, system, tools: [slow, fast], history: [], input: "go", ctx });
    expect(res.newMessages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "slow done" },
        { type: "tool_result", tool_use_id: "b", content: "fast done" },
      ],
    });
    expect(res.newMessages).toHaveLength(4);
  });

  it("passes a tool error to the model, which carries on", async () => {
    const model = createFakeModel([
      { tools: [{ id: "tu_h", name: "hold_slot", input: { service_id: "svc_1", start: "2026-10-30T10:00" } }] },
      { text: "Sorry, that time was just taken. 11:00 is free instead." },
    ]);
    const { events, onEvent } = collect();
    const res = await runAgent({ model, system, tools, history: [], input: "10:00 please", ctx, onEvent });
    expect(res.newMessages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_h", content: '{"error":"slot_taken","message":"That time was just taken; offer another."}', is_error: true }],
    });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true, output: { error: "slot_taken" } });
    expect(res.status).toBe("done");
  });

  it("stops after maxIterations with the fallback text, keeping the history valid", async () => {
    const loop = () => ({ tools: [{ name: "list_services" }] });
    const model = createFakeModel([loop, loop, loop, loop]);
    const { events, onEvent } = collect();
    const res = await runAgent({ model, system, tools, history: [], input: "loop", ctx, onEvent, maxIterations: 3, fallbackText: "Désolé !" });
    expect(model.requests).toHaveLength(3);
    expect(res.status).toBe("max_iterations");
    expect(res.text).toBe("Désolé !");
    expect(res.newMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(res.newMessages.at(-2)?.content).toMatchObject([{ type: "tool_result" }]);
    expect(res.newMessages.at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: "Désolé !" }] });
    expect(events).toContainEqual({ type: "error", code: "max_iterations", message: "Stopped after 3 model calls.", retryable: false });
    expect(events.at(-1)).toMatchObject({ type: "message_complete", synthetic: true });
  });

  it("surfaces a model error as an event and answers with the fallback text", async () => {
    const model = createFakeModel([{ error: new ModelError("rate_limited", "429 rate limited", { retryable: true }) }]);
    const { events, onEvent } = collect();
    const res = await runAgent({ model, system, tools, history: [], input: "Hi", ctx, onEvent });
    expect(res).toEqual({
      newMessages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Sorry, I can't answer right now. Please try again in a moment." }] },
      ],
      text: "Sorry, I can't answer right now. Please try again in a moment.",
      status: "error",
    });
    expect(events[0]).toEqual({ type: "error", code: "rate_limited", message: "429 rate limited", retryable: true });
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });

  it("never runs the tools of a refused or truncated turn", async () => {
    const run = vi.fn(async () => ok("ran"));
    const spy = tool({ name: "spy", description: "", input: z.object({}), run });
    for (const stopReason of ["refusal", "max_tokens"]) {
      const model = createFakeModel([{ raw: { content: [{ type: "tool_use", id: "x", name: "spy", input: {} }], stopReason, model: "m" } }]);
      const res = await runAgent({ model, system, tools: [spy], history: [], input: "x", ctx });
      expect(res.status).toBe("error");
      expect(res.newMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("echoes thinking blocks inside the run but does not store them", async () => {
    const thinking = { type: "thinking" as const, thinking: "", signature: "sig_1" };
    const model = createFakeModel([
      { raw: { content: [thinking, { type: "tool_use", id: "tu_1", name: "list_services", input: {} }], stopReason: "tool_use", model: "m" } },
      { text: "We offer knotless braids." },
    ]);
    const res = await runAgent({ model, system, tools, history: [], input: "Services?", ctx });
    expect(model.requests[1]?.messages[1]).toEqual({ role: "assistant", content: [thinking, { type: "tool_use", id: "tu_1", name: "list_services", input: {} }] });
    expect(res.newMessages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "list_services", input: {} }] });
  });

  it("sends prepared history and a system event as a plain user message", async () => {
    const history: AgentMessage[] = [
      { role: "assistant", content: "stray" },
      { role: "user", content: [{ type: "text", text: "Book braids" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "old" }, { type: "text", text: "Held for 15 minutes." }] },
    ];
    const model = createFakeModel([{ text: "Your booking is confirmed!" }]);
    const input = systemEvent("payment_captured", { booking_ref: "K7X2PQ", amount_cents: 3250 });
    expect(input).toBe('[event] payment_captured {"booking_ref":"K7X2PQ","amount_cents":3250}');
    const res = await runAgent({ model, system, tools, history, input, ctx });
    expect(model.requests[0]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Book braids" }] },
      { role: "assistant", content: [{ type: "text", text: "Held for 15 minutes." }] },
      { role: "user", content: [{ type: "text", text: input }] },
    ]);
    expect(res.newMessages[0]).toEqual({ role: "user", content: [{ type: "text", text: input }] });
  });

  it("keeps going when the event handler throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createFakeModel([{ tools: [{ name: "list_services" }] }, { text: "Done." }]);
    const res = await runAgent({
      model,
      system,
      tools,
      history: [],
      input: "x",
      ctx,
      onEvent: async () => {
        throw new Error("db down");
      },
    });
    expect(res).toMatchObject({ status: "done", text: "Done." });
  });
});
