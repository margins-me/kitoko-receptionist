// DEV FAKE. A scripted stand-in for Claude, for tests and for a local demo without an API key (AGENT_FAKE=1).
// It understands nothing: it replays a script, or follows one canned booking path.
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, AssistantBlock, Model, ModelRequest, ModelTurn } from "./types";
import { ModelError } from "./types";

export type FakeToolCall = { name: string; input?: Record<string, unknown>; id?: string };

/** One scripted model call. A function step decides from the request (e.g. to read a tool result). */
export type FakeStep =
  | { text: string }
  | { tools: FakeToolCall[]; text?: string }
  | { raw: ModelTurn }
  | { error: Error }
  | ((req: ModelRequest) => FakeStep);

export type FakeModel = Model & {
  /** A copy of every request received, in order. */
  readonly requests: ModelRequest[];
};

let ids = 0;
const toolUseId = () => `toolu_fake_${String(++ids).padStart(4, "0")}`;

function turnOf(step: Exclude<FakeStep, (req: ModelRequest) => FakeStep>): ModelTurn {
  if ("raw" in step) return step.raw;
  if ("error" in step) throw step.error;
  const content: AssistantBlock[] = [];
  if (step.text) content.push({ type: "text", text: step.text });
  if ("tools" in step) {
    for (const t of step.tools) content.push({ type: "tool_use", id: t.id ?? toolUseId(), name: t.name, input: t.input ?? {} });
    return { content, stopReason: "tool_use", model: "fake" };
  }
  return { content, stopReason: "end_turn", model: "fake" };
}

// Word by word, so streaming code paths run in tests too.
function stream(turn: ModelTurn, onText?: (delta: string) => void) {
  if (!onText) return;
  for (const b of turn.content) if (b.type === "text") for (const w of b.text.match(/\S+\s*/g) ?? []) onText(w);
}

function record(req: ModelRequest): ModelRequest {
  return { ...req, messages: structuredClone([...req.messages]) };
}

/**
 * A model that answers with `script`, one step per call; it throws once the script is used up. Without a script it is
 * the rule-based dev fake (see createRuleBasedModel).
 */
export function createFakeModel(script?: readonly FakeStep[], options?: RuleBasedOptions): FakeModel {
  if (!script) return createRuleBasedModel(options);
  const steps = [...script];
  const requests: ModelRequest[] = [];
  return {
    id: "fake",
    requests,
    async respond(req, onText) {
      requests.push(record(req));
      let step = steps.shift();
      if (!step) throw new ModelError("unknown", `Fake model script used up after ${requests.length - 1} calls`);
      while (typeof step === "function") step = step(req);
      const turn = turnOf(step);
      stream(turn, onText);
      return turn;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rule-based mode: "book" → list_services → get_availability → hold_slot → create_deposit_link → echo the results.

/**
 * One step of the canned path: which tool to call next, with an input built from the tool results so far (by tool
 * name). Return null when the input cannot be built: the fake then says so.
 */
export type FakePlanStep = { tool: string; input: (results: Record<string, unknown>) => Record<string, unknown> | null };

export type RuleBasedOptions = { plan?: readonly FakePlanStep[] };

/** The first string or number found under one of `keys`, searching depth-first. */
export function findValue(value: unknown, keys: readonly string[]): string | number | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findValue(v, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const entries = Object.entries(value);
  for (const [k, v] of entries) if (keys.includes(k) && (typeof v === "string" || typeof v === "number")) return v;
  for (const [, v] of entries) {
    const found = findValue(v, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

const pick = (input: Record<string, string | number | undefined>) =>
  Object.values(input).every((v) => v !== undefined) ? (input as Record<string, unknown>) : null;

/**
 * Guesses snake_case inputs from the tool results. The tools author can pass a plan that matches the real schemas
 * (createModel(env, { plan })).
 */
export const DEMO_BOOKING_PLAN: readonly FakePlanStep[] = [
  { tool: "list_services", input: () => ({}) },
  {
    tool: "get_availability",
    input: (r) => pick({ service_id: findValue(r.list_services, ["service_id", "serviceId", "id"]) }),
  },
  {
    tool: "hold_slot",
    input: (r) =>
      pick({
        service_id: findValue(r.list_services, ["service_id", "serviceId", "id"]),
        start: findValue(r.get_availability, ["start", "starts_at", "startsAt", "at"]),
      }),
  },
  {
    tool: "create_deposit_link",
    input: (r) => pick({ booking_id: findValue(r.hold_slot, ["booking_id", "bookingId", "id"]) }),
  },
];

const LABEL = "(dev fake, no AI)";
const BOOK = /\b(book|booking|réserv|reserv|prenot|marcar|agendar)/i;

const blocksOf = (m: AgentMessage | undefined): Anthropic.ContentBlockParam[] =>
  !m ? [] : typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;

const parse = (content: Anthropic.ToolResultBlockParam["content"]): unknown => {
  const text = typeof content === "string" ? content : (content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const short = (value: unknown) => {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return json.length > 500 ? `${json.slice(0, 500)}…` : json;
};

/** Tool results of the current turn (since the last message the user typed), by tool name. */
function resultsSoFar(messages: readonly AgentMessage[]): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  const names = new Map<string, string>();
  const start = messages.findLastIndex((m) => m.role === "user" && blocksOf(m).some((b) => b.type === "text"));
  for (const m of messages.slice(Math.max(start, 0))) {
    for (const b of blocksOf(m)) {
      if (b.type === "tool_use") names.set(b.id, b.name);
      if (b.type === "tool_result") results[names.get(b.tool_use_id) ?? "?"] = parse(b.content);
    }
  }
  return results;
}

export function ruleBasedStep(req: ModelRequest, plan: readonly FakePlanStep[] = DEMO_BOOKING_PLAN): FakeStep {
  const last = req.messages.at(-1);
  const blocks = blocksOf(last);
  const toolResults = blocks.filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result");
  const available = new Set(req.tools.map((t) => t.name));

  if (toolResults.length === 0) {
    const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    if (text.startsWith("[event]")) return { text: `${LABEL} System event received: ${short(text.slice(7).trim())}` };
    const first = plan[0];
    if (BOOK.test(text) && first && available.has(first.tool)) {
      const input = first.input({});
      if (input) return { tools: [{ name: first.tool, input }] };
    }
    return { text: `${LABEL} I only follow a scripted booking path. Write "book" to try it.` };
  }

  // Answering tool results: find which tool ran, then take the next step of the plan.
  const asked = blocksOf(req.messages.at(-2)).filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");
  const lastTool = asked.at(-1)?.name ?? "?";
  const failed = toolResults.find((r) => r.is_error);
  if (failed) return { text: `${LABEL} ${lastTool} failed: ${short(parse(failed.content))}` };

  const results = resultsSoFar(req.messages);
  const next = plan[plan.findIndex((s) => s.tool === lastTool) + 1];
  if (next && plan.some((s) => s.tool === lastTool) && available.has(next.tool)) {
    const input = next.input(results);
    if (input) return { tools: [{ name: next.tool, input }] };
    return { text: `${LABEL} I could not build the input for ${next.tool} from: ${short(results)}` };
  }
  const lines = Object.entries(results).map(([name, value]) => `- ${name}: ${short(value)}`);
  return { text: [`${LABEL} Here is what the tools returned:`, ...lines].join("\n") };
}

/** The dev fake for local demos: a canned booking path, every reply labelled as fake. Never ends. */
export function createRuleBasedModel(options: RuleBasedOptions = {}): FakeModel {
  const requests: ModelRequest[] = [];
  return {
    id: "fake-rule-based",
    requests,
    async respond(req, onText) {
      requests.push(record(req));
      let step: FakeStep = ruleBasedStep(req, options.plan);
      while (typeof step === "function") step = step(req);
      const turn = { ...turnOf(step), model: "fake-rule-based" };
      stream(turn, onText);
      return turn;
    },
  };
}
