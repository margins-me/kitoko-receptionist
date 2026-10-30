import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildParams, createAnthropicModel, normalizeContent, toModelError } from "../src/model/anthropic";
import { createModel } from "../src/model/index";
import type { AgentMessage, ModelRequest } from "../src/model/types";

const tool = (name: string) => ({ name, description: name, input_schema: { type: "object" as const, properties: {} } });
const req: ModelRequest = {
  system: { base: "Rules and pro facts.", context: "Now: Tuesday 27 October 2026 at 14:05." },
  tools: [tool("list_services"), tool("hold_slot")],
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] },
  ],
};
const settings = { model: "claude-sonnet-5-5", effort: "medium" as const, maxTokens: 16_000 };

describe("buildParams", () => {
  const params = buildParams(req, settings);

  it("caches the tools, the stable system part and the last message; the time comes after the breakpoint", () => {
    expect(params.tools.map((t) => "cache_control" in t)).toEqual([false, true]);
    expect(params.system).toEqual([
      { type: "text", text: "Rules and pro facts.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Now: Tuesday 27 October 2026 at 14:05." },
    ]);
    expect(params.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t", content: "{}", cache_control: { type: "ephemeral" } }],
    });
    expect(params.messages[0]).toBe(req.messages[0]);
  });

  it("never mutates the caller's messages", () => {
    expect(req.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] });
  });

  it("uses adaptive thinking with effort, and the server-side refusal fallback", () => {
    expect(params).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 16_000, output_config: { effort: "medium" }, fallbacks: "default" });
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect("thinking" in params).toBe(false);
    expect("temperature" in params).toBe(false);
  });

  it("turns a string last message into a cached text block", () => {
    const p = buildParams({ ...req, messages: [{ role: "user", content: "Hi" }] }, settings);
    expect(p.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi", cache_control: { type: "ephemeral" } }] }]);
  });
});

describe("normalizeContent", () => {
  it("keeps text, thinking and tool_use as params", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "One moment.", citations: null },
      { type: "tool_use", id: "tu", name: "hold_slot", input: { a: 1 }, caller: { type: "direct" } },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    expect(normalizeContent(content)).toEqual([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "One moment." },
      { type: "tool_use", id: "tu", name: "hold_slot", input: { a: 1 } },
    ]);
  });

  it("after a refusal fallback, drops what the declined model wrote except its text", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "declined" },
      { type: "text", text: "Partial " },
      { type: "tool_use", id: "cut", name: "hold_slot", input: {} },
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-opus-4-8" } },
      { type: "text", text: "answer" },
      { type: "tool_use", id: "ok", name: "list_services", input: {} },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    expect(normalizeContent(content)).toEqual([
      { type: "text", text: "Partial " },
      { type: "text", text: "answer" },
      { type: "tool_use", id: "ok", name: "list_services", input: {} },
    ]);
  });
});

describe("toModelError", () => {
  const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { message: "x" } }, "x", new Headers());

  it("maps SDK errors to codes, most specific first", () => {
    expect(toModelError(apiError(429))).toMatchObject({ code: "rate_limited", retryable: true });
    expect(toModelError(apiError(401))).toMatchObject({ code: "auth", retryable: false });
    expect(toModelError(apiError(400))).toMatchObject({ code: "bad_request", retryable: false });
    expect(toModelError(apiError(529))).toMatchObject({ code: "overloaded", retryable: true });
    expect(toModelError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ code: "timeout", retryable: true });
    expect(toModelError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({ code: "network", retryable: true });
    expect(toModelError(new Anthropic.APIUserAbortError())).toMatchObject({ code: "aborted" });
    expect(toModelError(new Anthropic.AnthropicError("no credentials"))).toMatchObject({ code: "config" });
    expect(toModelError(new Error("?"))).toMatchObject({ code: "unknown" });
  });
});

describe("createAnthropicModel", () => {
  it("streams text and returns the normalized turn with usage", async () => {
    const sent: unknown[] = [];
    const message = {
      content: [{ type: "text", text: "Hello", citations: null }],
      stop_reason: "end_turn",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: null },
    };
    const client = {
      beta: {
        messages: {
          stream: (params: unknown) => {
            sent.push(params);
            const handlers: ((d: string) => void)[] = [];
            return {
              on: (_event: "text", fn: (d: string) => void) => (handlers.push(fn), undefined),
              finalMessage: async () => (handlers.forEach((h) => (h("Hel"), h("lo"))), message),
            };
          },
        },
      },
    } as unknown as Anthropic;
    const model = createAnthropicModel({ client, effort: "low" });
    const deltas: string[] = [];
    const messages: AgentMessage[] = [{ role: "user", content: "Hi" }];
    const turn = await model.respond({ ...req, messages }, (d) => deltas.push(d));
    expect(turn).toEqual({
      content: [{ type: "text", text: "Hello" }],
      stopReason: "end_turn",
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 900, cacheWriteTokens: 0 },
    });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(sent[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" } });
  });

  it("reads the model and effort from the environment", () => {
    expect(createModel({ AGENT_MODEL: "claude-opus-5-5" }).id).toBe("claude-opus-5-5");
    expect(createModel({}).id).toBe("claude-sonnet-5-5");
  });
});
