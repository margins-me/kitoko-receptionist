import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Result } from "@kitoko/booking/result";
import type { ToolSpec } from "../model/types";

/**
 * A tool failure the model reads: a short machine code ("slot_taken", "outside_policy") and, ideally, one sentence
 * telling the model what happened. `err("slot_taken")` from @kitoko/booking/result is a valid failure too.
 */
export type ToolError = { ok: false; error: string; message?: string };

/** What a tool returns: booking's Result, with an optional message on failures. */
export type ToolResult<T = unknown> = Result<T, string> | ToolError;

export const toolError = (error: string, message?: string): ToolError => (message ? { ok: false, error, message } : { ok: false, error });

/**
 * A tool the agent can call. `input` validates what the model sends (and becomes the JSON schema it sees); `run`
 * gets the parsed input and the caller's context (pro, conversation, db and PayPal clients, …). Tools take ids, never
 * amounts: every amount comes from @kitoko/booking or SQL.
 */
export type Tool<S extends z.ZodType = z.ZodType, Ctx = unknown> = {
  name: string;
  description: string;
  input: S;
  // Method syntax on purpose: a list of tools with different inputs stays assignable to Tool<z.ZodType, Ctx>[].
  run(input: z.output<S>, ctx: Ctx): Promise<ToolResult>;
  /** Ends the run when a turn calls only final tools and they all succeed: the model is not asked again. */
  final?: boolean;
};

/** Infers the input type from the schema: `defineTool<Ctx>()({ name, input: z.object(…), run })`. */
export const defineTool =
  <Ctx>() =>
  <S extends z.ZodType>(tool: Tool<S, Ctx>): Tool<S, Ctx> =>
    tool;

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** The tool list as the API takes it. Throws on a programming error (bad or duplicate name, non-object schema). */
export function toolSpecs<Ctx>(tools: readonly Tool<z.ZodType, Ctx>[]): ToolSpec[] {
  const seen = new Set<string>();
  return tools.map((t) => {
    if (!NAME.test(t.name)) throw new Error(`Tool name "${t.name}" must match ${NAME}`);
    if (seen.has(t.name)) throw new Error(`Duplicate tool "${t.name}"`);
    seen.add(t.name);
    const schema = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    if (schema.type !== "object") throw new Error(`Tool "${t.name}" input must be a z.object()`);
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
  });
}

/** Compact JSON for the model; plain strings are sent as they are. */
export function serializeOutput(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value ?? null) ?? "null");
}

export type ToolCallOutcome = {
  block: Anthropic.ToolResultBlockParam;
  /** What the model saw, parsed: the tool's value, or { error, message }. */
  output: unknown;
  isError: boolean;
  /** Internal detail for agent_events (an exception message); never sent to the model. */
  detail?: string;
  ms: number;
};

/** Validates, runs and serializes one tool call. Never throws: every failure becomes an is_error tool_result. */
export async function callTool<Ctx>(
  tools: ReadonlyMap<string, Tool<z.ZodType, Ctx>>,
  call: { id: string; name: string; input: unknown },
  ctx: Ctx,
): Promise<ToolCallOutcome> {
  const started = performance.now();
  const done = (output: unknown, isError: boolean, detail?: string): ToolCallOutcome => ({
    block: { type: "tool_result", tool_use_id: call.id, content: serializeOutput(output), ...(isError ? { is_error: true } : {}) },
    output,
    isError,
    ...(detail ? { detail } : {}),
    ms: Math.round(performance.now() - started),
  });

  const tool = tools.get(call.name);
  if (!tool) return done({ error: "unknown_tool", message: `There is no tool named ${call.name}.` }, true);

  const parsed = tool.input.safeParse(call.input);
  if (!parsed.success) return done({ error: "invalid_input", message: z.prettifyError(parsed.error) }, true);

  try {
    const result = await tool.run(parsed.data, ctx);
    if (result.ok) return done(result.value, false);
    return done("message" in result && result.message ? { error: result.error, message: result.message } : { error: result.error }, true);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return done({ error: "internal_error", message: "The tool failed unexpectedly. Do not call it again in this reply." }, true, detail);
  }
}
