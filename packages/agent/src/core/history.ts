import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage } from "../model/types";

type Block = Anthropic.ContentBlockParam;

/** Turns kept from storage by default: a booking conversation is short; older turns only cost tokens. */
export const DEFAULT_HISTORY_TURNS = 20;

const blocksOf = (m: AgentMessage): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content]);

/** A user message that starts a turn: the client (or a system event) wrote something, it is not only tool results. */
const startsTurn = (m: AgentMessage): boolean => m.role === "user" && blocksOf(m).some((b) => b.type !== "tool_result");

const toolUseIds = (m: AgentMessage | undefined): Set<string> =>
  new Set(m?.role === "assistant" ? blocksOf(m).flatMap((b) => (b.type === "tool_use" ? [b.id] : [])) : []);

const toolResultIds = (m: AgentMessage | undefined): Set<string> =>
  new Set(m?.role === "user" ? blocksOf(m).flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])) : []);

/**
 * Stored messages, made safe to send:
 * - thinking blocks are dropped: the system prompt carries the current time, so a block from an earlier request
 *   would no longer match its conversation (the API rejects or drops it); the run that produced it already used it;
 * - a tool_use without its tool_result right after (a run that crashed mid-way), and a tool_result without its
 *   tool_use, are dropped, and tool results lead their message as the API requires;
 * - only the last `maxTurns` turns are kept, cut at the start of a turn so a tool_use never loses its tool_result;
 * - the history starts with a user message.
 */
export function prepareHistory(messages: readonly AgentMessage[], maxTurns = DEFAULT_HISTORY_TURNS): AgentMessage[] {
  const cleaned = messages.map((m) => ({
    role: m.role,
    content: blocksOf(m).filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking"),
  }));

  const paired = cleaned.map((m, i): AgentMessage => {
    if (m.role === "assistant") {
      const answered = toolResultIds(cleaned[i + 1]);
      return { role: m.role, content: m.content.filter((b) => b.type !== "tool_use" || answered.has(b.id)) };
    }
    const asked = toolUseIds(cleaned[i - 1]);
    const results = m.content.filter((b) => b.type === "tool_result" && asked.has(b.tool_use_id));
    return { role: m.role, content: [...results, ...m.content.filter((b) => b.type !== "tool_result")] };
  });
  const nonEmpty = paired.filter((m) => m.content.length > 0);

  const starts = nonEmpty.flatMap((m, i) => (startsTurn(m) ? [i] : []));
  const from = starts.length > maxTurns ? (starts.at(-maxTurns) ?? 0) : (starts[0] ?? nonEmpty.length);
  return mergeUserMessages(nonEmpty.slice(Math.max(from, 0)));
}

/**
 * Consecutive user messages as one (tool results first): a run that ended on a final tool leaves its tool results
 * last, and the next message the client writes follows them.
 */
export function mergeUserMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    const prev = out.at(-1);
    if (prev?.role === "user" && m.role === "user") {
      const blocks = [...blocksOf(prev), ...blocksOf(m)];
      out[out.length - 1] = { role: "user", content: [...blocks.filter((b) => b.type === "tool_result"), ...blocks.filter((b) => b.type !== "tool_result")] };
    } else out.push(m);
  }
  return out;
}

/** The visible text of a message's blocks. */
export function textOf(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n\n")
    .trim();
}
