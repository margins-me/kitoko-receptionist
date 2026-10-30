import "server-only";
import { toWaId } from "./phone";
import { renderText, toButtonsPayload, toCloudApiPayload, toTextPayload } from "./render";
import type { ReplyButton } from "./render";
import type { Locale, TemplateName, TemplateVars } from "./templates";

export type SendResult = { ok: true; providerId: string; text?: string } | { ok: false; error: string; retryable: boolean };

export type SendDeps = { fetch: typeof fetch; env: Record<string, string | undefined> };

// Cloud API limits (developers.facebook.com/documentation/business-messaging/whatsapp/messages).
export const TEXT_MAX = 4096;
export const BUTTONS_BODY_MAX = 1024;
export const BUTTONS_MAX = 3;
export const BUTTON_TITLE_MAX = 20;
export const BUTTON_ID_MAX = 256;

const defaultDeps = (): SendDeps => ({ fetch, env: process.env });

export async function sendTemplate<N extends TemplateName>(
  msg: { to: string; name: N; locale: Locale; vars: TemplateVars<N> },
  deps: SendDeps = defaultDeps(),
): Promise<SendResult> {
  return send(
    { to: msg.to, label: `${msg.name}, ${msg.locale}`, text: renderText(msg.name, msg.locale, msg.vars) },
    () => toCloudApiPayload(msg.name, msg.locale, msg.to, msg.vars),
    deps,
  );
}

/** Free-form text: delivered only inside the 24-hour window that opens when the person last wrote to us. */
export async function sendText(msg: { to: string; text: string }, deps: SendDeps = defaultDeps()): Promise<SendResult> {
  if (!msg.text.trim()) return final("text is empty");
  if (msg.text.length > TEXT_MAX) return final(`text is longer than ${TEXT_MAX} characters`);
  return send({ to: msg.to, label: "text", text: msg.text }, () => toTextPayload(msg.to, msg.text), deps);
}

/** Text with up to 3 reply buttons; a tap comes back as an inbound message with the button's id (see parseInbound). */
export async function sendButtons(
  msg: { to: string; text: string; buttons: readonly ReplyButton[] },
  deps: SendDeps = defaultDeps(),
): Promise<SendResult> {
  const problem = buttonsProblem(msg.text, msg.buttons);
  if (problem) return final(problem);
  const text = [msg.text, msg.buttons.map((b) => `[${b.title}]`).join(" ")].join("\n\n");
  return send({ to: msg.to, label: "buttons", text }, () => toButtonsPayload(msg.to, msg.text, msg.buttons), deps);
}

function buttonsProblem(text: string, buttons: readonly ReplyButton[]): string | null {
  if (!text.trim()) return "text is empty";
  if (text.length > BUTTONS_BODY_MAX) return `text is longer than ${BUTTONS_BODY_MAX} characters`;
  if (buttons.length === 0 || buttons.length > BUTTONS_MAX) return `between 1 and ${BUTTONS_MAX} buttons are allowed`;
  for (const b of buttons) {
    if (!b.title.trim() || b.title.length > BUTTON_TITLE_MAX) return `button title "${b.title}" must be 1 to ${BUTTON_TITLE_MAX} characters`;
    if (!b.id || b.id.length > BUTTON_ID_MAX) return `button id must be 1 to ${BUTTON_ID_MAX} characters`;
  }
  if (new Set(buttons.map((b) => b.id)).size !== buttons.length) return "button ids must be unique";
  if (new Set(buttons.map((b) => b.title)).size !== buttons.length) return "button titles must be unique";
  return null;
}

const final = (error: string): SendResult => ({ ok: false, error, retryable: false });

async function send(
  msg: { to: string; label: string; text: string },
  payload: () => unknown,
  deps: SendDeps,
): Promise<SendResult> {
  const { env } = deps;
  // `log` unless the deployment opts in to Meta: a missing variable never sends a real message (docs/architecture.md).
  const transport = env.WHATSAPP_TRANSPORT || "log";

  if (transport === "log") {
    console.info(`[whatsapp:log] to ${toWaId(msg.to)} (${msg.label})\n${msg.text}`);
    return { ok: true, providerId: `log-${crypto.randomUUID()}`, text: msg.text };
  }
  if (transport !== "cloud") return final(`Unknown WHATSAPP_TRANSPORT "${transport}"`);

  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return final("WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required");

  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION ?? "v24.0"}/${phoneId}/messages`;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }

  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  };
  const id = json.messages?.[0]?.id;
  if (res.ok && id) return { ok: true, providerId: id };
  return {
    ok: false,
    error: json.error ? `${json.error.code ?? res.status}: ${json.error.message ?? "unknown error"}` : `HTTP ${res.status}`,
    retryable: res.status === 429 || res.status >= 500 || THROTTLED.has(json.error?.code ?? 0),
  };
}

// Meta reports throttling with HTTP 400 and these codes; retrying later succeeds.
const THROTTLED = new Set([4, 80007, 130429, 131048, 131056]);
