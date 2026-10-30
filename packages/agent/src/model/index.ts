import { createAnthropicModel, DEFAULT_MODEL, EFFORTS } from "./anthropic";
import type { Effort } from "./anthropic";
import { createRuleBasedModel } from "./fake";
import type { RuleBasedOptions } from "./fake";
import type { Model } from "./types";

export * from "./types";
export { buildParams, createAnthropicModel, DEFAULT_MODEL, EFFORTS, normalizeContent, toModelError } from "./anthropic";
export type { AnthropicModelOptions, Effort } from "./anthropic";
export * from "./fake";

const isEffort = (x: string | undefined): x is Effort => (EFFORTS as readonly string[]).includes(x ?? "");

/**
 * The model for this environment: the rule-based dev fake when AGENT_FAKE=1 (local demo, no key), else Claude
 * (AGENT_MODEL, default claude-sonnet-5-5; AGENT_EFFORT, default medium). Nothing is read from the network here.
 */
export function createModel(env: Record<string, string | undefined> = process.env, fake?: RuleBasedOptions): Model {
  if (env.AGENT_FAKE === "1") return createRuleBasedModel(fake);
  return createAnthropicModel({
    model: env.AGENT_MODEL || DEFAULT_MODEL,
    ...(isEffort(env.AGENT_EFFORT) ? { effort: env.AGENT_EFFORT } : {}),
    ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
  });
}
