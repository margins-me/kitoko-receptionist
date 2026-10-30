import "server-only";

// Every environment variable of docs/architecture.md, read lazily so a build or a page that never needs one does not
// fail on it. Required ones throw a clear error when read unset; the others fall back to the documented default.

function read(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example).`);
  return value;
}

const optional = (name: string): string | null => process.env[name] || null;

const flag = (name: string): boolean => process.env[name] === "1" || process.env[name] === "true";

function oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const value = process.env[name] || fallback;
  if (!(values as readonly string[]).includes(value)) throw new Error(`${name} must be one of ${values.join(", ")}, got "${value}".`);
  return value as T;
}

export const env = {
  get SUPABASE_URL() {
    return read("SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY() {
    return read("SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Same project as SUPABASE_URL, for the browser client (dashboard Realtime and auth). */
  get NEXT_PUBLIC_SUPABASE_URL() {
    return read("NEXT_PUBLIC_SUPABASE_URL");
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  /** Public base URL: PayPal return URLs and links in messages. */
  get SITE_URL(): URL {
    const value = read("SITE_URL");
    try {
      return new URL(value);
    } catch {
      throw new Error(`SITE_URL must be an absolute URL, got "${value}".`);
    }
  },

  /** Claude. Unset is only allowed with AGENT_FAKE=1 (scripted model, local dev and tests). */
  get ANTHROPIC_API_KEY() {
    return read("ANTHROPIC_API_KEY");
  },
  get AGENT_FAKE(): boolean {
    return flag("AGENT_FAKE");
  },
  get AGENT_MODEL() {
    return optional("AGENT_MODEL") ?? "claude-sonnet-5-5";
  },

  /** "sandbox" (default) or "fake", the in-process PayPal for local dev and tests. */
  get PAYPAL_ENV(): "sandbox" | "fake" {
    return oneOf("PAYPAL_ENV", ["sandbox", "fake"] as const, "sandbox");
  },
  get PAYPAL_CLIENT_ID() {
    return read("PAYPAL_CLIENT_ID");
  },
  get PAYPAL_CLIENT_SECRET() {
    return read("PAYPAL_CLIENT_SECRET");
  },
  get NEXT_PUBLIC_PAYPAL_CLIENT_ID() {
    return read("NEXT_PUBLIC_PAYPAL_CLIENT_ID");
  },
  /** Id of the webhook registered on the sandbox app, needed to verify signatures. */
  get PAYPAL_WEBHOOK_ID() {
    return read("PAYPAL_WEBHOOK_ID");
  },

  /** "log" (default, prints messages) or "cloud" (WhatsApp Cloud API). */
  get WHATSAPP_TRANSPORT(): "log" | "cloud" {
    return oneOf("WHATSAPP_TRANSPORT", ["log", "cloud"] as const, "log");
  },
  get WHATSAPP_PHONE_NUMBER_ID() {
    return read("WHATSAPP_PHONE_NUMBER_ID");
  },
  get WHATSAPP_ACCESS_TOKEN() {
    return read("WHATSAPP_ACCESS_TOKEN");
  },
  get WHATSAPP_API_VERSION() {
    return optional("WHATSAPP_API_VERSION") ?? "v24.0";
  },
  get WHATSAPP_VERIFY_TOKEN() {
    return read("WHATSAPP_VERIFY_TOKEN");
  },
  get WHATSAPP_APP_SECRET() {
    return read("WHATSAPP_APP_SECRET");
  },
  /** Handle of the pro a WhatsApp client talks to (one test number serves one pro). */
  get WHATSAPP_DEMO_PRO() {
    return read("WHATSAPP_DEMO_PRO");
  },
};
