import "server-only";
import { deliver as deliverOnChannel } from "@kitoko/channels";
import type { DeliverResult } from "@kitoko/channels";
import type { ReplyButton } from "@kitoko/channels";
import { serviceClient } from "@kitoko/db";
import type { Db } from "@kitoko/db";
import { createClient as createPayPalClient, defaultDeps } from "@kitoko/paypal";
import type { PayPalClient } from "@kitoko/paypal";
import { createAnthropicModel, EFFORTS } from "../model/anthropic";
import type { Effort } from "../model/anthropic";
import { createRuleBasedModel } from "../model/fake";
import type { Model } from "../model/types";

export type Env = Record<string, string | undefined>;

export type AgentKind = "client" | "pro";

/** A message to send on a conversation's channel (WhatsApp sends it; web and MCP replies are already stored rows). */
export type OutboundMessage = { channel: "web" | "whatsapp" | "mcp"; to: string; text: string; buttons?: readonly ReplyButton[] };

/**
 * What every service needs, built once per process (createServicesCtx) or per request. Services take it as their
 * first argument and never read process.env themselves.
 */
export type ServicesCtx = {
  /** Service-role Supabase client: the SQL functions and the agent tables. */
  db: Db;
  paypal: PayPalClient;
  env: Env;
  now: () => Date;
  /** Public base URL without a trailing slash (PayPal return URLs, links in messages). */
  siteUrl: string;
  deliver: (msg: OutboundMessage) => Promise<DeliverResult>;
  /** The model for the client receptionist or the pro assistant. */
  model: (kind: AgentKind) => Model;
  /**
   * Runs follow-up work that must not delay the caller (the agent's message after a capture, a sick-day cascade).
   * Default: awaited inline (tests, scripts). Route handlers pass Next's `after()`.
   */
  defer: (task: () => Promise<unknown>) => void | Promise<void>;
};

export const DEFAULT_CLIENT_MODEL = "claude-haiku-5-5";
export const DEFAULT_PRO_MODEL = "claude-sonnet-5-5";

const isEffort = (x: string | undefined): x is Effort => (EFFORTS as readonly string[]).includes(x ?? "");

/**
 * The model for each agent: the rule-based dev fake when AGENT_FAKE=1; else Claude, AGENT_MODEL_CLIENT (default
 * claude-haiku-5-5, effort medium) for clients and AGENT_MODEL_PRO (default claude-sonnet-5-5) for the pro.
 */
export function modelFactory(env: Env): (kind: AgentKind) => Model {
  const cache = new Map<AgentKind, Model>();
  return (kind) => {
    const cached = cache.get(kind);
    if (cached) return cached;
    let model: Model;
    if (env.AGENT_FAKE === "1") {
      model = createRuleBasedModel();
    } else {
      const id = kind === "client" ? env.AGENT_MODEL_CLIENT || DEFAULT_CLIENT_MODEL : env.AGENT_MODEL_PRO || env.AGENT_MODEL || DEFAULT_PRO_MODEL;
      const effort = kind === "client" ? "medium" : isEffort(env.AGENT_EFFORT) ? env.AGENT_EFFORT : "medium";
      model = createAnthropicModel({ model: id, effort, ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}) });
    }
    cache.set(kind, model);
    return model;
  };
}

const swallow = async (task: () => Promise<unknown>) => {
  try {
    await task();
  } catch (e) {
    console.error("[services] deferred task failed", e);
  }
};

/** The context from environment variables (SUPABASE_*, PAYPAL_*, SITE_URL, ANTHROPIC_API_KEY, AGENT_*, WHATSAPP_*). */
export function createServicesCtx(env: Env = process.env, overrides: Partial<ServicesCtx> = {}): ServicesCtx {
  const sendDeps = { fetch: ((input, init) => fetch(input, init)) as typeof fetch, env };
  return {
    db: overrides.db ?? serviceClient(),
    paypal: overrides.paypal ?? createPayPalClient(defaultDeps(env)),
    env,
    now: overrides.now ?? (() => new Date()),
    siteUrl: (overrides.siteUrl ?? env.SITE_URL?.trim() ?? "http://localhost:3300").replace(/\/+$/, "") || "http://localhost:3300",
    deliver: overrides.deliver ?? ((msg) => deliverOnChannel(msg, sendDeps)),
    model: overrides.model ?? modelFactory(env),
    defer: overrides.defer ?? swallow,
  };
}
