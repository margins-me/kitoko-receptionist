import "server-only";
import { z } from "zod";
import { ok } from "@kitoko/booking/result";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { toolError } from "../core/tools";
import type { Tool } from "../core/tools";
import type { Env } from "../services/ctx";

/**
 * The only PayPal Agent Toolkit actions the pro assistant may run: reads. Anything else is refused by the guard below
 * even if the toolkit offered it (refunds, payouts and invoices go through pending actions and her button).
 */
export const PAYPAL_TOOLKIT_ACTIONS = {
  transactions: { list: true },
  invoices: { list: true, get: true },
  payments: { getRefunds: true },
  disputes: { list: true, get: true },
};

export const PAYPAL_TOOLKIT_READS = new Set(["list_transactions", "list_invoices", "get_invoice", "get_refund", "list_disputes", "get_dispute"]);

export const PAYPAL_TOOL_PREFIX = "paypal_";

let cached: { key: string; toolkit: PayPalAgentToolkit } | undefined;

function toolkitFor(env: Env): PayPalAgentToolkit | null {
  const mode = env.PAYPAL_ENV?.trim() || "sandbox";
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  // The fake PayPal (local dev, tests) has no toolkit counterpart; without sandbox credentials there is nothing to read.
  if (mode !== "sandbox" || !clientId || !clientSecret) return null;
  const key = `${clientId}:${clientSecret.length}`;
  if (cached?.key !== key) {
    cached = { key, toolkit: new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: PAYPAL_TOOLKIT_ACTIONS, context: { sandbox: true } } }) };
  }
  return cached.toolkit;
}

/** The toolkit's JSON schema as a zod object (our Tool type validates with zod); a loose object if it cannot be read. */
function toZod(parameters: unknown): z.ZodType {
  try {
    const schema = { ...(parameters as Record<string, unknown>) };
    delete schema.$schema;
    const converted = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    if (converted instanceof z.ZodObject) return converted;
  } catch {
    // fall through
  }
  return z.looseObject({});
}

let callSeq = 0;

/**
 * PayPal Agent Toolkit (@paypal/agent-toolkit, OpenAI format) read tools for the pro assistant, renamed paypal_*:
 * list transactions, list/get invoices, get a refund, list/get disputes. Empty without sandbox credentials.
 */
export function paypalToolkitTools<Ctx>(env: Env): Tool<z.ZodType, Ctx>[] {
  const toolkit = toolkitFor(env);
  if (!toolkit) return [];
  return toolkit
    .getTools()
    .filter((t) => PAYPAL_TOOLKIT_READS.has(t.function.name))
    .map((t): Tool<z.ZodType, Ctx> => {
      const method = t.function.name;
      return {
        name: `${PAYPAL_TOOL_PREFIX}${method}`,
        description: `PayPal Agent Toolkit (read only), on Kitoko's PayPal sandbox account shared by every pro: ${(t.function.description ?? method).trim().slice(0, 900)}`,
        input: toZod(t.function.parameters),
        async run(input) {
          // Guard: only the read actions above, whatever the model asks for.
          if (!PAYPAL_TOOLKIT_READS.has(method)) return toolError("not_allowed", "Only PayPal read actions are allowed.");
          try {
            const res = await toolkit.handleToolCall({
              id: `call_${++callSeq}`,
              type: "function",
              function: { name: method, arguments: JSON.stringify(input ?? {}) },
            });
            const content = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
            let value: unknown = content;
            try {
              value = JSON.parse(content);
            } catch {
              // plain text answer
            }
            const text = typeof value === "string" ? value : JSON.stringify(value);
            return ok(text.length > 12_000 ? `${text.slice(0, 12_000)}… (truncated)` : value);
          } catch (e) {
            return toolError("paypal_error", e instanceof Error ? e.message.slice(0, 300) : "PayPal did not answer.");
          }
        },
      };
    });
}
