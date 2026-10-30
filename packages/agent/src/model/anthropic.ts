import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, AssistantBlock, Model, ModelRequest, ModelTurn } from "./types";
import { ModelError } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type AnthropicModelOptions = {
  /** Model id, default claude-sonnet-5-5 (AGENT_MODEL). */
  model?: string;
  /** Adaptive thinking depth. Default "medium": multi-step tool use in a chat. */
  effort?: Effort;
  maxTokens?: number;
  /** Defaults to the SDK's own resolution (ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile). */
  apiKey?: string;
  /** Injected in tests. */
  client?: Anthropic;
};

const ephemeral = { type: "ephemeral" } as const;

/**
 * The Messages API request for one model call.
 *
 * - Cache breakpoints: the last tool (caches the tool list), the stable system part (tools + rules + pro facts), and
 *   the last message (so each tool-loop iteration re-reads the previous one from cache). The date/time part of the
 *   system prompt sits after the system breakpoint.
 * - Thinking: omitted, so the model thinks adaptively; `effort` sets the depth. Thinking cannot be disabled on
 *   claude-sonnet-5-5.
 * - `fallbacks: "default"`: if the model declines for policy reasons, the API retries on its default fallback model
 *   inside the same call (Claude API only). Sent only for the models that have a server-side fallback
 *   (claude-sonnet-5-5 and the Opus family); Haiku has none.
 * - eager_input_streaming stays off: tool inputs are a few ids, so the API's own schema check is worth more than
 *   streaming them early.
 */
export function buildParams(req: ModelRequest, opts: { model: string; effort: Effort; maxTokens: number }) {
  const tools = req.tools.map((t, i) => (i === req.tools.length - 1 ? { ...t, cache_control: ephemeral } : t));
  return {
    model: opts.model,
    max_tokens: req.maxTokens ?? opts.maxTokens,
    system: [
      { type: "text" as const, text: req.system.base, cache_control: ephemeral },
      ...(req.system.context ? [{ type: "text" as const, text: req.system.context }] : []),
    ],
    tools,
    messages: withLastBlockCached(req.messages),
    output_config: { effort: opts.effort },
    ...(hasServerFallback(opts.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

/** Models with a server-side refusal fallback: claude-sonnet-5-5 and claude-opus-*. */
export const hasServerFallback = (model: string): boolean => model.startsWith("claude-sonnet-5-5") || model.startsWith("claude-opus-");

function withLastBlockCached(messages: readonly AgentMessage[]): AgentMessage[] {
  const out = [...messages];
  const last = out.at(-1);
  if (!last) return out;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const tail = blocks.at(-1);
  if (!tail || tail.type === "thinking" || tail.type === "redacted_thinking") return out;
  blocks[blocks.length - 1] = { ...tail, cache_control: ephemeral };
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

/**
 * The blocks to echo back as this assistant turn. After a refusal fallback the blocks the declined model wrote before
 * the last `fallback` marker are dropped except its text (the API's echo rule); the marker itself is an audit block
 * the core does not need. Anything this agent never asks for (server tools, citations) is dropped.
 */
export function normalizeContent(content: readonly Anthropic.Beta.BetaContentBlock[]): AssistantBlock[] {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  const out: AssistantBlock[] = [];
  content.forEach((b, i) => {
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (i < boundary) return;
    else if (b.type === "thinking") out.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
    else if (b.type === "redacted_thinking") out.push({ type: "redacted_thinking", data: b.data });
    else if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
  });
  return out;
}

export function toModelError(e: unknown): ModelError {
  if (e instanceof ModelError) return e;
  const message = e instanceof Error ? e.message : String(e);
  // Most specific first: the abort and connection errors extend APIError.
  if (e instanceof Anthropic.APIUserAbortError) return new ModelError("aborted", message, { cause: e });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ModelError("timeout", message, { retryable: true, cause: e });
  if (e instanceof Anthropic.APIConnectionError) return new ModelError("network", message, { retryable: true, cause: e });
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ModelError("auth", message, { cause: e });
  }
  if (e instanceof Anthropic.RateLimitError) return new ModelError("rate_limited", message, { retryable: true, cause: e });
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new ModelError("bad_request", message, { cause: e });
  }
  if (e instanceof Anthropic.APIError) {
    const overloaded = typeof e.status === "number" && e.status >= 500;
    return new ModelError(overloaded ? "overloaded" : "unknown", message, { retryable: overloaded, cause: e });
  }
  // Raised by the client itself, e.g. no credentials could be resolved.
  if (e instanceof Anthropic.AnthropicError) return new ModelError("config", message, { cause: e });
  return new ModelError("unknown", message, { cause: e });
}

/** The real model. The client (and so the API key) is created on the first call, not at import. */
export function createAnthropicModel(opts: AnthropicModelOptions = {}): Model {
  const model = opts.model || DEFAULT_MODEL;
  const settings = { model, effort: opts.effort ?? "medium", maxTokens: opts.maxTokens ?? 16_000 };
  let client = opts.client;

  return {
    id: model,
    async respond(req, onText): Promise<ModelTurn> {
      try {
        client ??= new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
        const stream = client.beta.messages.stream(buildParams(req, settings), { signal: req.signal });
        if (onText) stream.on("text", (delta) => onText(delta));
        const message = await stream.finalMessage();
        return {
          content: normalizeContent(message.content),
          stopReason: message.stop_reason ?? "end_turn",
          model: message.model,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (e) {
        throw toModelError(e);
      }
    },
  };
}
