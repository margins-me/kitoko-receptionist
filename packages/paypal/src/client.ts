import "server-only";
import { z } from "zod";
import { readConfig } from "./config";
import type { PayPalConfig, PayPalDeps } from "./config";
import { getFakePayPal } from "./fake";
import { err, ok } from "./result";
import type { Result } from "./result";

export type PayPalErrorCode =
  | "declined"
  | "already_captured"
  | "not_found"
  | "unprocessable"
  | "auth"
  | "network"
  | "unknown";

export type PayPalError = {
  code: PayPalErrorCode;
  /** HTTP status; null when no response came back (network) or the call never left (config, validation). */
  status: number | null;
  /** First `details[].issue` (INSTRUMENT_DECLINED…), else PayPal's error `name`. */
  issue: string | null;
  message: string;
  /** `paypal-debug-id` response header (or body `debug_id`): quote it to PayPal support. */
  debugId: string | null;
  /** True for 5xx, 429 and in-progress conflicts that outlived our retries: try again later with the same request id. */
  retryable: boolean;
};

export type Prefer = "return=minimal" | "return=representation";

/**
 * Every POST carries a PayPal-Request-Id. Pass a key that is stable for the operation (our row id), so a retry, a
 * double click or the webhook backstop replays PayPal's first answer instead of acting twice. PayPal keeps the key
 * for up to 45 days.
 */
export type PostRequest = {
  method: "POST";
  path: string;
  requestId: string;
  body?: unknown;
  /** A body already serialized (webhook verification embeds the raw event verbatim). Wins over `body`. */
  rawBody?: string;
  prefer?: Prefer;
};
export type GetRequest = { method: "GET"; path: string; query?: Record<string, string | number | undefined> };
export type PayPalRequest = PostRequest | GetRequest;

export type PayPalClient = {
  readonly config: Result<PayPalConfig, string>;
  request<S extends z.ZodType>(req: PayPalRequest, schema: S): Promise<Result<z.output<S>, PayPalError>>;
};

const MAX_RETRIES = 2;
const TIMEOUT_MS = 20_000;
/** Renew the token this long before PayPal says it expires. */
const TOKEN_MARGIN_S = 60;

const DECLINED_ISSUES = new Set([
  "INSTRUMENT_DECLINED",
  "PAYER_CANNOT_PAY",
  "PAYMENT_DENIED",
  "TRANSACTION_REFUSED",
  "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED",
  "PAYER_ACCOUNT_RESTRICTED",
  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "TRANSACTION_LIMIT_EXCEEDED",
  "TRANSACTION_RECEIVING_LIMIT_EXCEEDED",
  "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
  "COMPLIANCE_VIOLATION",
]);

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });

const errorBodySchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional(), description: z.string().optional() })).optional(),
  // OAuth endpoint errors
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export function paypalError(
  code: PayPalErrorCode,
  message: string,
  extra: Partial<Omit<PayPalError, "code" | "message">> = {},
): PayPalError {
  return { code, message, status: null, issue: null, debugId: null, retryable: false, ...extra };
}

export function toPayPalError(status: number, json: unknown, headers?: Headers): PayPalError {
  const body = errorBodySchema.safeParse(json);
  const b = body.success ? body.data : {};
  const issue = b.details?.[0]?.issue ?? b.name ?? b.error ?? null;
  const debugId = headers?.get("paypal-debug-id") ?? b.debug_id ?? null;
  const message = b.details?.[0]?.description ?? b.message ?? b.error_description ?? `HTTP ${status}`;
  const retryable = status >= 500 || status === 429 || issue === "PREVIOUS_REQUEST_IN_PROGRESS";
  let code: PayPalErrorCode;
  if (status === 401 || status === 403) code = "auth";
  else if (status === 404) code = "not_found";
  else if (issue && DECLINED_ISSUES.has(issue)) code = "declined";
  else if (issue === "ORDER_ALREADY_CAPTURED") code = "already_captured";
  else if (status === 400 || status === 409 || status === 422) code = "unprocessable";
  else code = "unknown";
  return { code, status, issue, message, debugId, retryable };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createClient(deps: PayPalDeps): PayPalClient {
  const config = readConfig(deps.env);
  const sleep = deps.sleep ?? defaultSleep;
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<Result<string, PayPalError>> | null = null;

  function backoff(attempt: number, res?: Response): number {
    const retryAfter = Number(res?.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 5000);
    return 300 * 3 ** attempt; // 300 ms, 900 ms
  }

  /** fetch with retries on network errors, 5xx and 429 (max 2). POSTs are safe to repeat thanks to PayPal-Request-Id. */
  async function send(url: string, init: RequestInit): Promise<Result<Response, PayPalError>> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        return err(paypalError("network", e instanceof Error ? e.message : String(e), { retryable: true }));
      }
      if ((res.status >= 500 || res.status === 429) && attempt < MAX_RETRIES) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(backoff(attempt, res));
        continue;
      }
      return ok(res);
    }
  }

  async function fetchToken(cfg: PayPalConfig): Promise<Result<string, PayPalError>> {
    const sent = await send(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!sent.ok) return sent;
    const res = sent.value;
    const json = await readJson(res);
    if (!res.ok) {
      const e = toPayPalError(res.status, json, res.headers);
      return err(res.status === 400 || res.status === 401 ? { ...e, code: "auth" } : e);
    }
    const parsed = tokenSchema.safeParse(json);
    if (!parsed.success) return err(paypalError("auth", "Malformed OAuth token response", { status: res.status }));
    const ttl = Math.max(0, parsed.data.expires_in - TOKEN_MARGIN_S) * 1000;
    cached = { token: parsed.data.access_token, expiresAt: deps.now() + ttl };
    return ok(parsed.data.access_token);
  }

  function token(cfg: PayPalConfig, force: boolean): Promise<Result<string, PayPalError>> {
    if (force) cached = null;
    if (cached && deps.now() < cached.expiresAt) return Promise.resolve(ok(cached.token));
    inflight ??= fetchToken(cfg).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function request<S extends z.ZodType>(req: PayPalRequest, schema: S): Promise<Result<z.output<S>, PayPalError>> {
    if (!config.ok) return err(paypalError("auth", config.error));
    const cfg = config.value;
    if (req.method === "POST" && !req.requestId.trim()) {
      return err(paypalError("unprocessable", `PayPal-Request-Id is required for POST ${req.path}`));
    }

    let url = `${cfg.baseUrl}${req.path}`;
    if (req.method === "GET" && req.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) if (v !== undefined) q.set(k, String(v));
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }

    // One forced token refresh if PayPal rejects a cached token (revoked or clock skew).
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      const t = await token(cfg, authAttempt > 0);
      if (!t.ok) return t;
      const headers: Record<string, string> = { Authorization: `Bearer ${t.value}`, Accept: "application/json" };
      let body: string | undefined;
      if (req.method === "POST") {
        headers["Content-Type"] = "application/json";
        headers["PayPal-Request-Id"] = req.requestId;
        if (req.prefer) headers.Prefer = req.prefer;
        body = req.rawBody ?? JSON.stringify(req.body ?? {});
      }

      const sent = await send(url, { method: req.method, headers, body });
      if (!sent.ok) return sent;
      const res = sent.value;
      if (res.status === 401 && authAttempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      const json = await readJson(res);
      if (!res.ok) return err(toPayPalError(res.status, json, res.headers));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return err(
          paypalError("unknown", `Unexpected PayPal response for ${req.method} ${req.path}: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim(), {
            status: res.status,
            issue: "UNEXPECTED_RESPONSE",
            debugId: res.headers.get("paypal-debug-id"),
          }),
        );
      }
      return ok(parsed.data);
    }
    return err(paypalError("auth", "PayPal rejected a fresh access token", { status: 401 }));
  }

  return { config, request };
}

/** process.env deps. With PAYPAL_ENV=fake, fetch goes to the process-wide fake PayPal instead of the network. */
export function defaultDeps(env: Record<string, string | undefined> = process.env): PayPalDeps {
  const fake = env.PAYPAL_ENV?.trim() === "fake";
  return {
    fetch: fake ? getFakePayPal().fetch : (input, init) => fetch(input, init),
    env,
    now: () => Date.now(),
  };
}

let shared: PayPalClient | undefined;

/** The process-wide client every module function uses when none is passed. */
export function defaultClient(): PayPalClient {
  shared ??= createClient(defaultDeps());
  return shared;
}
