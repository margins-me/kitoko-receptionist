import type Anthropic from "@anthropic-ai/sdk";

/** A conversation message as stored in conversation_messages (role + Anthropic content blocks) and sent to the model. */
export type AgentMessage = Anthropic.UserMessageParam | Anthropic.AssistantMessageParam;

/** What an assistant turn may hold. Thinking blocks are echoed back inside one run, never stored. */
export type AssistantBlock =
  | Anthropic.TextBlockParam
  | Anthropic.ThinkingBlockParam
  | Anthropic.RedactedThinkingBlockParam
  | Anthropic.ToolUseBlockParam;

/**
 * A system prompt in two parts. `base` is stable for a pro and a conversation (rules, pro facts, language), so it is
 * cached with the tools. `context` changes on every request (today's date and time) and is sent after the cache
 * breakpoint, so it never invalidates the cached part.
 */
export type SystemPrompt = { base: string; context: string };

/** A tool as the model sees it. */
export type ToolSpec = { name: string; description: string; input_schema: Anthropic.Tool.InputSchema };

export type ModelRequest = {
  system: SystemPrompt;
  tools: readonly ToolSpec[];
  messages: readonly AgentMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type ModelTurn = {
  content: AssistantBlock[];
  /** Anthropic stop reasons: end_turn, tool_use, max_tokens, refusal, pause_turn, … */
  stopReason: string;
  /** The model that answered (a refusal fallback can answer with another one). */
  model: string;
  usage?: Usage;
};

/** One model call; `onText` receives the visible text as it streams. Throws ModelError. */
export interface Model {
  readonly id: string;
  respond(req: ModelRequest, onText?: (delta: string) => void): Promise<ModelTurn>;
}

export type ModelErrorCode =
  | "auth"
  | "config"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "network"
  | "timeout"
  | "aborted"
  | "unknown";

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;

  constructor(code: ModelErrorCode, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ModelError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
