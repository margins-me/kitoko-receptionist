import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AgentMessage, AssistantBlock, Model, ModelTurn, SystemPrompt, Usage } from "../model/types";
import { ModelError } from "../model/types";
import { DEFAULT_HISTORY_TURNS, mergeUserMessages, prepareHistory } from "./history";
import type { Tool } from "./tools";
import { callTool, toolSpecs } from "./tools";

export type AgentErrorCode = ModelError["code"] | "refusal" | "truncated" | "max_iterations";

/** Everything a run does, in order. Every tool call and result goes through here so the caller can log agent_events. */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: unknown; isError: boolean; ms: number; detail?: string }
  /**
   * An assistant message was added to newMessages (the stored form: text and tool_use only). `synthetic` marks the
   * fallback text the core wrote itself after an error.
   */
  | { type: "message_complete"; content: AssistantBlock[]; stopReason: string; model: string; ms: number; usage?: Usage; synthetic?: true }
  | { type: "error"; code: AgentErrorCode; message: string; retryable: boolean };

export type RunStatus = "done" | "max_iterations" | "error";

export type RunResult = {
  /** To append to conversation_messages, in order: the user turn, assistant turns, tool_result turns. */
  newMessages: AgentMessage[];
  /** The visible reply of this run (all its assistant text), to deliver on the channel. Empty if the model said nothing. */
  text: string;
  status: RunStatus;
};

export type RunOptions<Ctx> = {
  model: Model;
  system: SystemPrompt;
  tools: readonly Tool<z.ZodType, Ctx>[];
  /** Stored messages of the conversation, oldest first. Cleaned and trimmed here (see prepareHistory). */
  history: readonly AgentMessage[];
  /** The client's or pro's message, or a system event ("[event] …", see systemEvent). */
  input: string;
  ctx: Ctx;
  /** Model calls per run. Default 8. */
  maxIterations?: number;
  /** Turns kept from history. Default 20. */
  maxHistoryTurns?: number;
  maxTokens?: number;
  /** What the user reads when the run fails (see fallbackText in prompts/fallback). Default English, formal. */
  fallbackText?: string;
  /** Awaited for every event but text_delta (which streams synchronously). A throwing handler never stops the run. */
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
};

export const DEFAULT_FALLBACK_TEXT = "Sorry, I can't answer right now. Please try again in a moment.";

/** The stored form of an assistant turn: thinking blocks only make sense inside the run that produced them. */
const stored = (content: readonly AssistantBlock[]): AssistantBlock[] =>
  content.filter((b) => b.type === "text" || b.type === "tool_use");

const visibleText = (messages: readonly AgentMessage[]): string =>
  messages
    .filter((m) => m.role === "assistant" && typeof m.content !== "string")
    .flatMap((m) => (m.content as Anthropic.ContentBlockParam[]).flatMap((b) => (b.type === "text" ? [b.text.trim()] : [])))
    .filter(Boolean)
    .join("\n\n");

/**
 * One agent turn: sends the conversation to the model, runs the tools it asks for (all calls of a turn in parallel,
 * their results in one user message), and repeats until the model answers without tools or `maxIterations` calls
 * were made. Never throws for model or tool failures: they become an `error` event and the fallback text, so the
 * conversation stays valid and the user always gets an answer.
 */
export async function runAgent<Ctx>(opts: RunOptions<Ctx>): Promise<RunResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const specs = toolSpecs(opts.tools);
  const byName = new Map(opts.tools.map((t) => [t.name, t]));

  const emit = async (event: AgentEvent) => {
    try {
      await opts.onEvent?.(event);
    } catch (e) {
      console.warn("[agent] onEvent handler failed", e);
    }
  };
  // emit calls the handler synchronously, so deltas arrive in order without being awaited.
  const streamText = (text: string) => void emit({ type: "text_delta", text });

  const userTurn: AgentMessage = { role: "user", content: [{ type: "text", text: opts.input }] };
  const messages: AgentMessage[] = mergeUserMessages([...prepareHistory(opts.history, opts.maxHistoryTurns ?? DEFAULT_HISTORY_TURNS), userTurn]);
  const newMessages: AgentMessage[] = [userTurn];

  const fail = async (code: AgentErrorCode, message: string, retryable: boolean, status: RunStatus): Promise<RunResult> => {
    await emit({ type: "error", code, message, retryable });
    const text = opts.fallbackText ?? DEFAULT_FALLBACK_TEXT;
    const content: AssistantBlock[] = [{ type: "text", text }];
    streamText(text);
    newMessages.push({ role: "assistant", content });
    await emit({ type: "message_complete", content, stopReason: code, model: opts.model.id, ms: 0, synthetic: true });
    return { newMessages, text: visibleText(newMessages), status };
  };

  for (let i = 0; i < maxIterations; i++) {
    const started = performance.now();
    let turn: ModelTurn;
    try {
      turn = await opts.model.respond(
        { system: opts.system, tools: specs, messages, ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}), ...(opts.signal ? { signal: opts.signal } : {}) },
        streamText,
      );
    } catch (e) {
      const err = e instanceof ModelError ? e : new ModelError("unknown", e instanceof Error ? e.message : String(e), { cause: e });
      return fail(err.code, err.message, err.retryable, "error");
    }
    const ms = Math.round(performance.now() - started);
    const calls = turn.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");

    // A refusal can cut a tool_use off mid-input, and so can max_tokens: never run that turn's tools.
    if (turn.stopReason === "refusal") return fail("refusal", "The model declined to answer.", false, "error");
    if (turn.stopReason === "max_tokens" && calls.length > 0) return fail("truncated", "A tool call was cut off by max_tokens.", false, "error");

    messages.push({ role: "assistant", content: turn.content });
    const content = stored(turn.content);
    if (content.length > 0) newMessages.push({ role: "assistant", content });
    await emit({ type: "message_complete", content, stopReason: turn.stopReason, model: turn.model, ms, ...(turn.usage ? { usage: turn.usage } : {}) });

    if (calls.length === 0) {
      // pause_turn only comes from server tools, which this agent does not use; resend if it ever happens.
      if (turn.stopReason === "pause_turn") continue;
      return { newMessages, text: visibleText(newMessages), status: "done" };
    }

    for (const call of calls) await emit({ type: "tool_call", id: call.id, name: call.name, input: call.input });
    const outcomes = await Promise.all(
      calls.map(async (call) => {
        const outcome = await callTool(byName, call, opts.ctx);
        await emit({
          type: "tool_result",
          id: call.id,
          name: call.name,
          output: outcome.output,
          isError: outcome.isError,
          ms: outcome.ms,
          ...(outcome.detail ? { detail: outcome.detail } : {}),
        });
        return outcome;
      }),
    );
    const results: AgentMessage = { role: "user", content: outcomes.map((o) => o.block) };
    messages.push(results);
    newMessages.push(results);
    if (calls.every((c) => byName.get(c.name)?.final) && outcomes.every((o) => !o.isError)) {
      return { newMessages, text: visibleText(newMessages), status: "done" };
    }
  }

  return fail("max_iterations", `Stopped after ${maxIterations} model calls.`, false, "max_iterations");
}
