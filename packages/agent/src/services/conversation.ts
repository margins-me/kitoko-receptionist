import "server-only";
import { fromPrice } from "@kitoko/booking";
import type { Locale } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import { whatsappText } from "@kitoko/channels";
import type { ReplyButton } from "@kitoko/channels";
import { isLocale } from "@kitoko/i18n";
import {
  appendMessage,
  BOOKING_COLUMNS,
  getConversation,
  getConversationByToken,
  getOrCreateConversation,
  getPro,
  getProByHandle,
  listConversationBookings,
  listMessages,
  listServices,
  listStaff,
  toBookingDetail,
} from "@kitoko/db";
import type { BookingDetail, BookingSource, Channel, Conversation, Json, PendingAction, Pro } from "@kitoko/db";
import { textOf } from "../core/history";
import { runAgent } from "../core/run";
import type { AgentEvent } from "../core/run";
import { isSystemEvent, systemEvent } from "../core/system-events";
import type { SystemEventKind } from "../core/system-events";
import type { AgentMessage } from "../model/types";
import { buildClientPrompt, CLIENT_TOOLS } from "../prompts/client";
import { fallbackText } from "../prompts/fallback";
import { buildProPrompt } from "../prompts/pro";
import { clientTools } from "../tools/client";
import type { ClientToolCtx } from "../tools/client";
import { buildProTools } from "../tools/pro";
import type { ProToolCtx } from "../tools/pro";
import { decideAction } from "./actions";
import type { ServicesCtx } from "./ctx";
import { iso, isUuid, logEvent, moneyText, nowMs } from "./util";

/** Client messages per conversation per hour (web chat abuse, runaway WhatsApp loops). */
export const MESSAGES_PER_HOUR = 30;

const E164 = /^\+[1-9]\d{6,14}$/;
const asPhone = (externalId: string): string | null => {
  const p = `+${externalId.replace(/^\+/, "")}`;
  return E164.test(p) ? p : null;
};

/**
 * The bookings a client conversation may see and act on: its own, plus (WhatsApp) those of the same phone number with
 * this pro. Newest first.
 */
export async function conversationBookings(ctx: ServicesCtx, conversation: Conversation): Promise<BookingDetail[]> {
  const own = await listConversationBookings(ctx.db, conversation.id);
  const byId = new Map(own.map((b) => [b.id, b]));
  const phone = conversation.channel === "whatsapp" ? asPhone(conversation.externalId) : null;
  if (phone) {
    const { data: clients } = await ctx.db.from("clients").select("id").eq("pro_id", conversation.proId).eq("phone_e164", phone);
    const ids = (clients ?? []).map((c) => c.id);
    if (ids.length) {
      const { data } = await ctx.db.from("bookings").select(BOOKING_COLUMNS).eq("pro_id", conversation.proId).in("client_id", ids);
      for (const row of data ?? []) if (!byId.has(row.id)) byId.set(row.id, toBookingDetail(row));
    }
  }
  return [...byId.values()].filter((b) => b.proId === conversation.proId).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------------------------------------------
// One agent run on a conversation
// ---------------------------------------------------------------------------------------------------------------

/** handleMessage's events: the agent's own (text deltas, tool calls, ...) and, first, the conversation it runs in. */
export type HandleEvent = AgentEvent | { type: "conversation"; conversationId: string; token: string; created: boolean };

async function servicesSummary(ctx: ServicesCtx, pro: Pro): Promise<string> {
  const services = await listServices(ctx.db, pro.id);
  return services
    .map((s) => {
      const from = fromPrice(s);
      const minutes = from.minMinutes === from.maxMinutes ? `${from.minMinutes} min` : `${from.minMinutes}-${from.maxMinutes} min`;
      return `- ${s.name.fr}: from ${moneyText(from.priceCents, "en", pro.currency)}, ${minutes}${s.description ? `. ${s.description}` : ""}`;
    })
    .join("\n");
}

async function clientFirstName(ctx: ServicesCtx, conversation: Conversation): Promise<string | undefined> {
  if (!conversation.clientId) return undefined;
  const { data } = await ctx.db.from("clients").select("first_name").eq("id", conversation.clientId).maybeSingle();
  return data?.first_name ?? undefined;
}

const SOURCE: Record<Channel, BookingSource> = { web: "web", whatsapp: "whatsapp", mcp: "mcp" };

/** Booking id in a tool's input or output (for agent_events.booking_id). */
function bookingIdOf(...values: unknown[]): string | null {
  for (const v of values) {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["booking_id", "bookingId"]) if (isUuid(o[k])) return o[k] as string;
    }
  }
  return null;
}

type RunOutcome = { text: string; actions: PendingAction[] };

/**
 * Runs the conversation's agent on `input` (a client's or pro's message, or a system event), stores the new messages
 * (the user turn hidden when it is an event), logs every tool call and model turn to agent_events, and delivers the
 * reply on WhatsApp. Web and MCP read the stored rows.
 */
async function runConversation(
  ctx: ServicesCtx,
  conversation: Conversation,
  pro: Pro,
  input: string,
  opts: { onEvent?: ((e: HandleEvent) => void | Promise<void>) | undefined } = {},
): Promise<RunOutcome> {
  const history = (await listMessages(ctx.db, conversation.id, { limit: 400 })).map((m) => ({ role: m.role, content: m.content }) as AgentMessage);
  const channel = conversation.channel === "whatsapp" ? "whatsapp" : "web";
  const now = ctx.now();
  const actions: PendingAction[] = [];
  const isClient = conversation.kind === "client";

  const clientCtx: ClientToolCtx = {
    services: ctx,
    pro,
    conversation,
    source: SOURCE[conversation.channel],
    turn: { byClient: !isSystemEvent(input), previewed: new Set() },
  };
  const proCtx: ProToolCtx = { services: ctx, pro, conversation, actions };

  let system;
  if (isClient) {
    const firstName = await clientFirstName(ctx, conversation);
    system = buildClientPrompt({
      pro: { name: pro.name, city: pro.city ?? pro.areaLabel ?? "", currency: pro.currency, timezone: pro.timezone, services: await servicesSummary(ctx, pro) },
      now,
      locale: conversation.locale,
      channel,
      ...(firstName ? { clientFirstName: firstName } : {}),
    });
  } else {
    const staff = await listStaff(ctx.db, pro.id);
    system = buildProPrompt({
      pro: { name: pro.name, firstName: staff[0]?.name ?? pro.name.split(" ")[0] ?? pro.name, city: pro.city ?? "", currency: pro.currency, timezone: pro.timezone },
      now,
      locale: pro.locale,
      channel,
    });
  }

  const calls = new Map<string, unknown>();
  const onEvent = async (e: AgentEvent) => {
    if (e.type === "tool_call") calls.set(e.id, e.input);
    if (e.type === "tool_result") {
      const toolInput = calls.get(e.id);
      await logEvent(ctx, {
        kind: e.isError ? "error" : "tool",
        name: e.name,
        conversationId: conversation.id,
        bookingId: bookingIdOf(e.output, toolInput),
        input: toolInput ?? null,
        output: e.detail ? { ...(e.output as object), detail: e.detail } : e.output,
        ms: e.ms,
      });
    } else if (e.type === "message_complete") {
      await logEvent(ctx, {
        kind: "model",
        name: e.synthetic ? "model.fallback" : "model.turn",
        conversationId: conversation.id,
        output: { model: e.model, stopReason: e.stopReason, ...(e.usage ? { usage: e.usage } : {}), tools: e.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : [])) },
        ms: e.ms,
      });
    } else if (e.type === "error") {
      await logEvent(ctx, { kind: "error", name: `agent.${e.code}`, conversationId: conversation.id, output: { message: e.message, retryable: e.retryable } });
    }
    await opts.onEvent?.(e);
  };

  const result = isClient
    ? await runAgent<ClientToolCtx>({
        model: ctx.model("client"),
        system,
        tools: clientTools,
        history,
        input,
        ctx: clientCtx,
        maxIterations: 10,
        fallbackText: fallbackText("client", clientCtx.conversation.locale),
        onEvent,
      })
    : await runAgent<ProToolCtx>({
        model: ctx.model("pro"),
        system,
        tools: buildProTools(ctx.env),
        history,
        input,
        ctx: proCtx,
        maxIterations: 10,
        fallbackText: fallbackText("pro", pro.locale),
        onEvent,
      });

  const hiddenInput = isSystemEvent(input);
  for (const [index, m] of result.newMessages.entries()) {
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const visible = index === 0 ? !hiddenInput : blocks.some((b) => b.type === "text" && b.text.trim().length > 0);
    await appendMessage(ctx.db, { conversationId: conversation.id, role: m.role, content: blocks as unknown as NonNullable<Json>, visible });
  }

  if (conversation.channel === "whatsapp" && result.text) {
    const buttons = isClient ? replyButtons(result.newMessages, result.text) : undefined;
    const sent = await ctx.deliver({ channel: "whatsapp", to: conversation.externalId, text: result.text, ...(buttons ? { buttons } : {}) });
    if (!sent.ok) await logEvent(ctx, { kind: "error", name: "whatsapp.send", conversationId: conversation.id, output: sent });
  }
  if (conversation.channel === "whatsapp" && !isClient) {
    for (const a of actions) {
      await ctx.deliver({
        channel: "whatsapp",
        to: conversation.externalId,
        text: a.summary,
        buttons: [
          { id: `action:${a.id}:confirm`, title: BUTTONS[pro.locale].confirm },
          { id: `action:${a.id}:cancel`, title: BUTTONS[pro.locale].cancel },
        ],
      });
    }
  }
  return { text: result.text, actions };
}

/**
 * The receptionist's offer_choices as WhatsApp reply buttons, when Meta takes them (3 at most, 20-character titles,
 * a 1024-character body). A tap comes back as a message whose text is the title. Otherwise the text alone, which
 * lists the options anyway.
 */
export function replyButtons(messages: readonly AgentMessage[], text: string): ReplyButton[] | undefined {
  let choices: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      const input = b.type === "tool_use" && b.name === CLIENT_TOOLS.offerChoices ? (b.input as { choices?: unknown }) : null;
      if (Array.isArray(input?.choices)) choices = input.choices.map(String);
    }
  }
  const fits = choices.length > 0 && choices.length <= 3 && choices.every((c) => c.trim().length > 0 && c.length <= 20) && new Set(choices).size === choices.length;
  return fits && whatsappText(text).length <= 1024 ? choices.map((title, k) => ({ id: `choice:${k}`, title })) : undefined;
}

const BUTTONS: Record<Locale, { confirm: string; cancel: string; done: string; dropped: string; failed: string }> = {
  en: { confirm: "Confirm", cancel: "Cancel", done: "Done", dropped: "Cancelled, nothing was sent.", failed: "It did not go through" },
  fr: { confirm: "Confirmer", cancel: "Annuler", done: "C'est fait", dropped: "Annulé, rien n'a été envoyé.", failed: "Ça n'est pas passé" },
  it: { confirm: "Conferma", cancel: "Annulla", done: "Fatto", dropped: "Annullato, non è stato inviato nulla.", failed: "Non è andato a buon fine" },
  es: { confirm: "Confirmar", cancel: "Cancelar", done: "Hecho", dropped: "Cancelado, no se envió nada.", failed: "No se ha podido hacer" },
  pt: { confirm: "Confirmar", cancel: "Cancelar", done: "Feito", dropped: "Cancelado, nada foi enviado.", failed: "Não foi possível" },
};

// ---------------------------------------------------------------------------------------------------------------
// Proactive messages
// ---------------------------------------------------------------------------------------------------------------

/**
 * A server event for a conversation (payment captured, sick-day displacement, proposed move...): appended as a hidden
 * "[event] ..." user message, the agent writes what the client should read, and it is delivered on her channel.
 */
export async function notifyConversation(
  ctx: ServicesCtx,
  i: { conversationId: string; event: SystemEventKind | (string & {}); data?: Record<string, unknown> },
): Promise<Result<{ text: string }, string>> {
  const conversation = await getConversation(ctx.db, i.conversationId);
  if (!conversation) return err("not_found");
  const pro = await getPro(ctx.db, conversation.proId);
  if (!pro) return err("not_found");
  await logEvent(ctx, { kind: "system", name: `event.${i.event}`, conversationId: conversation.id, bookingId: bookingIdOf(i.data), input: i.data ?? null });
  const run = await runConversation(ctx, conversation, pro, systemEvent(i.event, i.data));
  return ok({ text: run.text });
}

// ---------------------------------------------------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------------------------------------------------

export type HandleMessageInput = {
  channel: Channel;
  /** whatsapp: the sender's E.164 number; mcp: the session; web: none (the token identifies the chat). */
  externalId?: string;
  /** web: the chat's token; absent or unknown starts a new conversation. */
  token?: string;
  /** client conversations: the pro's handle (or proId). */
  proHandle?: string;
  kind: "client" | "pro";
  proId?: string;
  text: string;
  /** A WhatsApp reply-button id. */
  buttonId?: string;
  /** The page's language for a new web chat. */
  locale?: Locale;
  onEvent?: (e: HandleEvent) => void | Promise<void>;
};

export type HandleMessageResult = { conversationId: string; token: string; text: string };

const ACTION_BUTTON = /^action:([0-9a-f-]{36}):(confirm|cancel)$/i;

/**
 * One inbound message on any channel: finds or creates the conversation, runs the client or pro agent with its tools,
 * stores the messages, logs the tool calls and delivers the reply (WhatsApp). A pro's WhatsApp button reply on a
 * pending action goes straight to decideAction, never through the model.
 */
export async function handleMessage(ctx: ServicesCtx, i: HandleMessageInput): Promise<Result<HandleMessageResult, string>> {
  const text = i.text.trim();
  if (!text && !i.buttonId) return err("empty_message");
  if (text.length > 4000) return err("message_too_long");

  // The conversation, and the pro it belongs to.
  let conversation: Conversation | null = null;
  if (i.token) {
    const found = await getConversationByToken(ctx.db, i.token);
    if (found && found.kind === i.kind && (!i.proId || found.proId === i.proId)) conversation = found;
  }
  let pro: Pro | null = null;
  if (conversation) pro = await getPro(ctx.db, conversation.proId);
  else if (i.proId) pro = await getPro(ctx.db, i.proId);
  else if (i.proHandle) pro = await getProByHandle(ctx.db, i.proHandle);
  if (!pro) return err("pro_not_found");
  if (i.kind === "client" && !conversation && !pro.publishedAt) return err("pro_not_found");

  if (!conversation) {
    const locale = i.locale && isLocale(i.locale) ? i.locale : pro.locale;
    conversation = await getOrCreateConversation(ctx.db, {
      proId: pro.id,
      kind: i.kind,
      channel: i.channel,
      ...(i.externalId ? { externalId: i.externalId } : {}),
      locale: i.kind === "pro" ? pro.locale : locale,
    });
  }
  const created = conversation.lastMessageAt === null;
  await i.onEvent?.({ type: "conversation", conversationId: conversation.id, token: conversation.token, created: created || conversation.token !== i.token });

  // A pro's tap on a WhatsApp confirm/cancel button: the human decision, never the model's.
  const button = i.buttonId ? ACTION_BUTTON.exec(i.buttonId) : null;
  if (i.kind === "pro" && button) {
    const decision = button[2]!.toLowerCase() === "confirm" ? "confirmed" : "cancelled";
    const words = BUTTONS[pro.locale];
    const decided = await decideAction(ctx, { actionId: button[1]!.toLowerCase(), decision, proId: pro.id });
    const reply = !decided.ok
      ? `${words.failed}: ${decided.error}.`
      : decision === "cancelled"
        ? words.dropped
        : `${words.done}: ${decided.value.action.summary}.`;
    await appendMessage(ctx.db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: `[${decision === "confirmed" ? words.confirm : words.cancel}]` }] });
    await appendMessage(ctx.db, { conversationId: conversation.id, role: "assistant", content: [{ type: "text", text: reply }] });
    if (conversation.channel === "whatsapp") await ctx.deliver({ channel: "whatsapp", to: conversation.externalId, text: reply });
    return ok({ conversationId: conversation.id, token: conversation.token, text: reply });
  }

  if (i.kind === "client") {
    const { count } = await ctx.db
      .from("conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
      .eq("visible", true)
      .gte("created_at", iso(nowMs(ctx) - 3_600_000));
    if ((count ?? 0) >= MESSAGES_PER_HOUR) return err("rate_limited");
  }

  // Never let a typed message pose as a system event.
  const input = isSystemEvent(text) ? `(${text})` : text || "(button)";
  const run = await runConversation(ctx, conversation, pro, input, { onEvent: i.onEvent });
  return ok({ conversationId: conversation.id, token: conversation.token, text: run.text });
}

/** Visible messages of a web chat after a moment (polling for proactive messages). */
export async function chatMessages(
  ctx: ServicesCtx,
  i: { token: string; after?: number },
): Promise<Result<{ id: number; role: "user" | "assistant"; text: string; createdAt: string; choices?: string[] }[], string>> {
  const conversation = await getConversationByToken(ctx.db, i.token);
  if (!conversation) return err("not_found");
  const all = await listMessages(ctx.db, conversation.id);
  // The buttons of the latest offer_choices call go on the reply it belongs to (the first visible assistant message
  // from that call on), and only while that reply is the last message: a client message or a proactive one ends them.
  let offer: { from: number; choices: string[] } | null = null;
  for (const m of all) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content as unknown[]) {
      const block = b as { type?: string; name?: string; input?: { choices?: unknown } };
      if (block.type === "tool_use" && block.name === CLIENT_TOOLS.offerChoices && Array.isArray(block.input?.choices)) {
        offer = { from: m.id, choices: block.input.choices.map(String).slice(0, 4) };
      }
    }
  }
  const visible = all
    .filter((m) => m.visible)
    .map((m) => ({ id: m.id, role: m.role, text: textOf(m.content as AgentMessage["content"]), createdAt: iso(m.createdAt) }))
    .filter((m) => m.text.length > 0);
  const target = offer ? visible.find((m) => m.role === "assistant" && m.id >= offer.from) : undefined;
  const out = visible.map((m) => (offer && m === target && m === visible.at(-1) ? { ...m, choices: offer.choices } : m));
  return ok(out.filter((m) => i.after === undefined || Date.parse(m.createdAt) > i.after));
}

