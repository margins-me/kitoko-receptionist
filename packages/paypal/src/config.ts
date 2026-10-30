import "server-only";
import { err, ok } from "./result";
import type { Result } from "./result";

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

/** `sandbox` talks to PayPal's sandbox. `fake` runs the in-process fake (src/fake.ts): local dev and tests only. */
export type PayPalMode = "sandbox" | "fake";

/** Everything the client touches outside itself, injected so tests run without network or real time. */
export type PayPalDeps = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => number;
  /** Waits between retries. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
};

export type PayPalConfig = {
  mode: PayPalMode;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Id of the webhook registered on the sandbox app; needed to verify signatures. */
  webhookId: string | null;
  /** Public base URL, used for the fake approval page. */
  siteUrl: string;
};

export function readConfig(env: Record<string, string | undefined>): Result<PayPalConfig, string> {
  const mode = env.PAYPAL_ENV?.trim() || "sandbox";
  if (mode !== "sandbox" && mode !== "fake") return err(`Unknown PAYPAL_ENV "${mode}" (sandbox or fake)`);
  const siteUrl = (env.SITE_URL?.trim() || "http://localhost:3300").replace(/\/+$/, "");
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim() || null;

  if (mode === "fake") {
    return ok({
      mode,
      baseUrl: SANDBOX_BASE_URL,
      clientId: env.PAYPAL_CLIENT_ID?.trim() || "fake-client-id",
      clientSecret: env.PAYPAL_CLIENT_SECRET?.trim() || "fake-client-secret",
      webhookId: webhookId ?? "FAKE-WEBHOOK-ID",
      siteUrl,
    });
  }

  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return err("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
  return ok({ mode, baseUrl: SANDBOX_BASE_URL, clientId, clientSecret, webhookId, siteUrl });
}
