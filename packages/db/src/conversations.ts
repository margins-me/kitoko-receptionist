import { randomBytes } from "node:crypto";
import { toLocale } from "@kitoko/i18n";
import type { Locale } from "@kitoko/booking";
import { err, ok } from "@kitoko/booking/result";
import type { Result } from "@kitoko/booking/result";
import type { Db } from "./clients";
import { dbError } from "./errors";
import {
  AGENT_EVENT_KINDS,
  CHANNELS,
  CONVERSATION_KINDS,
  CURRENCIES,
  MESSAGE_ROLES,
  oneOf,
  oneOfOrNull,
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATUSES,
  epochOrNull,
} from "./rows";
import type {
  AgentEventKind,
  Channel,
  ConversationKind,
  Currency,
  MessageRole,
  PendingActionKind,
  PendingActionStatus,
} from "./rows";
import type { Json } from "./types.gen";

// Service client for everything here, except the pro's own reads (RLS) and decidePendingAction.

// ---------------------------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------------------------

export type Conversation = {
  id: string;
  proId: string;
  kind: ConversationKind;
  channel: Channel;
  /** web: the token; whatsapp: the wa_id; mcp: the session id. */
  externalId: string;
  clientId: string | null;
  locale: Locale;
  /** Unguessable: reopens a web chat (/{handle}?chat={token}). */
  token: string;
  lastMessageAt: number | null;
  createdAt: number;
};

const CONVERSATION_COLUMNS = "id, pro_id, kind, channel, external_id, client_id, locale, token, last_message_at, created_at";

type ConversationRow = {
  id: string;
  pro_id: string;
  kind: string;
  channel: string;
  external_id: string;
  client_id: string | null;
  locale: string;
  token: string;
  last_message_at: string | null;
  created_at: string;
};

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    proId: row.pro_id,
    kind: oneOf(CONVERSATION_KINDS, row.kind),
    channel: oneOf(CHANNELS, row.channel),
    externalId: row.external_id,
    clientId: row.client_id,
    locale: toLocale(row.locale),
    token: row.token,
    lastMessageAt: epochOrNull(row.last_message_at),
    createdAt: Date.parse(row.created_at),
  };
}

/** 64 hex characters, like the column default. */
export const newConversationToken = (): string => randomBytes(32).toString("hex");

/**
 * The conversation for (channel, externalId, pro, kind), created when new. A web chat without an externalId starts a
 * new conversation whose externalId is its token.
 */
export async function getOrCreateConversation(
  db: Db,
  input: {
    proId: string;
    kind: ConversationKind;
    channel: Channel;
    externalId?: string;
    locale?: Locale;
    clientId?: string | null;
  },
): Promise<Conversation> {
  const token = newConversationToken();
  const externalId = input.externalId ?? token;
  const find = () =>
    db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("channel", input.channel)
      .eq("external_id", externalId)
      .eq("pro_id", input.proId)
      .eq("kind", input.kind)
      .maybeSingle()
      .throwOnError();
  if (input.externalId !== undefined) {
    const { data } = await find();
    if (data) return toConversation(data);
  }
  await db
    .from("conversations")
    .upsert(
      {
        pro_id: input.proId,
        kind: input.kind,
        channel: input.channel,
        external_id: externalId,
        token,
        locale: input.locale,
        client_id: input.clientId ?? null,
      },
      { onConflict: "channel,external_id,pro_id,kind", ignoreDuplicates: true },
    )
    .throwOnError();
  const { data } = await find();
  if (!data) throw new Error("conversation not found after insert");
  return toConversation(data);
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  const { data, error } = await db.from("conversations").select(CONVERSATION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toConversation(data) : null;
}

/** A web chat reopened by its token, or null. */
export async function getConversationByToken(db: Db, token: string): Promise<Conversation | null> {
  const { data, error } = await db.from("conversations").select(CONVERSATION_COLUMNS).eq("token", token).maybeSingle();
  if (error) throw error;
  return data ? toConversation(data) : null;
}

/** Sets the conversation's language or client. */
export async function updateConversation(db: Db, id: string, patch: { locale?: Locale; clientId?: string | null }): Promise<void> {
  if (patch.locale === undefined && patch.clientId === undefined) return;
  await db
    .from("conversations")
    .update({ locale: patch.locale, client_id: patch.clientId })
    .eq("id", id)
    .throwOnError();
}

/** A pro's conversations, most recent first (dashboard). */
export async function listConversations(
  db: Db,
  proId: string,
  opts: { kind?: ConversationKind; limit?: number } = {},
): Promise<Conversation[]> {
  let query = db.from("conversations").select(CONVERSATION_COLUMNS).eq("pro_id", proId);
  if (opts.kind) query = query.eq("kind", opts.kind);
  const { data, error } = await query.order("last_message_at", { ascending: false, nullsFirst: false }).limit(opts.limit ?? 50);
  if (error) throw error;
  return data.map(toConversation);
}

// ---------------------------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------------------------

export type Message = {
  /** Increasing: poll with listMessages({ after: lastId }). */
  id: number;
  conversationId: string;
  role: MessageRole;
  /** Anthropic content blocks (or a plain string). */
  content: Json;
  /** False for system events injected for the agent ("[event] ..."). */
  visible: boolean;
  createdAt: number;
};

const MESSAGE_COLUMNS = "id, conversation_id, role, content, visible, created_at";

export function toMessage(row: {
  id: number;
  conversation_id: string;
  role: string;
  content: Json;
  visible: boolean;
  created_at: string;
}): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: oneOf(MESSAGE_ROLES, row.role),
    content: row.content,
    visible: row.visible,
    createdAt: Date.parse(row.created_at),
  };
}

export async function appendMessage(
  db: Db,
  input: { conversationId: string; role: MessageRole; content: NonNullable<Json>; visible?: boolean },
): Promise<Message> {
  const { data, error } = await db
    .from("conversation_messages")
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      visible: input.visible ?? true,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return toMessage(data);
}

/** Messages in order; `after` a message id (polling), `visibleOnly` for what the chat shows. */
export async function listMessages(
  db: Db,
  conversationId: string,
  opts: { after?: number; visibleOnly?: boolean; limit?: number } = {},
): Promise<Message[]> {
  let query = db.from("conversation_messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversationId);
  if (opts.after !== undefined) query = query.gt("id", opts.after);
  if (opts.visibleOnly) query = query.eq("visible", true);
  const { data, error } = await query.order("id").limit(opts.limit ?? 500);
  if (error) throw error;
  return data.map(toMessage);
}

// ---------------------------------------------------------------------------------------------------------------
// Agent events ("How it works")
// ---------------------------------------------------------------------------------------------------------------

export type AgentEvent = {
  id: number;
  proId: string | null;
  conversationId: string | null;
  bookingId: string | null;
  kind: AgentEventKind;
  name: string;
  input: Json | null;
  output: Json | null;
  ms: number | null;
  createdAt: number;
};

const AGENT_EVENT_COLUMNS = "id, pro_id, conversation_id, booking_id, kind, name, input, output, ms, created_at";

export function toAgentEvent(row: {
  id: number;
  pro_id: string | null;
  conversation_id: string | null;
  booking_id: string | null;
  kind: string;
  name: string;
  input: Json | null;
  output: Json | null;
  ms: number | null;
  created_at: string;
}): AgentEvent {
  return {
    id: row.id,
    proId: row.pro_id,
    conversationId: row.conversation_id,
    bookingId: row.booking_id,
    kind: oneOf(AGENT_EVENT_KINDS, row.kind),
    name: row.name,
    input: row.input,
    output: row.output,
    ms: row.ms,
    createdAt: Date.parse(row.created_at),
  };
}

/** One tool call and its result, a model turn, a PayPal call or webhook, or an error. pro_id is filled from the conversation or booking. */
export async function logAgentEvent(
  db: Db,
  input: {
    proId?: string | null;
    conversationId?: string | null;
    bookingId?: string | null;
    kind?: AgentEventKind;
    name: string;
    input?: Json;
    output?: Json;
    ms?: number;
  },
): Promise<number> {
  const { data, error } = await db
    .from("agent_events")
    .insert({
      pro_id: input.proId ?? null,
      conversation_id: input.conversationId ?? null,
      booking_id: input.bookingId ?? null,
      kind: input.kind ?? "tool",
      name: input.name,
      input: input.input ?? null,
      output: input.output ?? null,
      ms: input.ms === undefined ? null : Math.max(0, Math.round(input.ms)),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Events in order: of a conversation, or of a booking (its own events and those of the conversation it came from).
 * `after` an event id for polling.
 */
export async function listAgentEvents(
  db: Db,
  of: { bookingId: string } | { conversationId: string },
  opts: { after?: number; limit?: number } = {},
): Promise<AgentEvent[]> {
  let query = db.from("agent_events").select(AGENT_EVENT_COLUMNS);
  if ("conversationId" in of) {
    query = query.eq("conversation_id", of.conversationId);
  } else {
    const { data: booking, error } = await db.from("bookings").select("conversation_id").eq("id", of.bookingId).maybeSingle();
    if (error) throw error;
    query = booking?.conversation_id
      ? query.or(`booking_id.eq.${of.bookingId},conversation_id.eq.${booking.conversation_id}`)
      : query.eq("booking_id", of.bookingId);
  }
  if (opts.after !== undefined) query = query.gt("id", opts.after);
  const { data, error } = await query.order("id").limit(opts.limit ?? 500);
  if (error) throw error;
  return data.map(toAgentEvent);
}

// ---------------------------------------------------------------------------------------------------------------
// Pending actions
// ---------------------------------------------------------------------------------------------------------------

export type PendingAction = {
  id: string;
  proId: string;
  conversationId: string | null;
  bookingId: string | null;
  kind: PendingActionKind;
  /** What the confirm button says. */
  summary: string;
  amountCents: number | null;
  currency: Currency | null;
  /** What the app needs to carry it out (payment id, invoice lines...). */
  payload: Json;
  status: PendingActionStatus;
  decidedAt: number | null;
  /** What the app did after the decision. */
  result: Json | null;
  createdAt: number;
};

const PENDING_ACTION_COLUMNS =
  "id, pro_id, conversation_id, booking_id, kind, summary, amount_cents, currency, payload, status, decided_at, result, created_at";

export function toPendingAction(row: {
  id: string;
  pro_id: string;
  conversation_id: string | null;
  booking_id: string | null;
  kind: string;
  summary: string;
  amount_cents: number | null;
  currency: string | null;
  payload: Json;
  status: string;
  decided_at: string | null;
  result: Json | null;
  created_at: string;
}): PendingAction {
  return {
    id: row.id,
    proId: row.pro_id,
    conversationId: row.conversation_id,
    bookingId: row.booking_id,
    kind: oneOf(PENDING_ACTION_KINDS, row.kind),
    summary: row.summary,
    amountCents: row.amount_cents,
    currency: oneOfOrNull(CURRENCIES, row.currency),
    payload: row.payload,
    status: oneOf(PENDING_ACTION_STATUSES, row.status),
    decidedAt: epochOrNull(row.decided_at),
    result: row.result,
    createdAt: Date.parse(row.created_at),
  };
}

/** What the pro asked her assistant for, waiting for her button press. */
export async function createPendingAction(
  db: Db,
  input: {
    proId: string;
    kind: PendingActionKind;
    summary: string;
    conversationId?: string | null;
    bookingId?: string | null;
    amountCents?: number | null;
    currency?: Currency | null;
    payload?: Json;
  },
): Promise<PendingAction> {
  const { data, error } = await db
    .from("pending_actions")
    .insert({
      pro_id: input.proId,
      kind: input.kind,
      summary: input.summary,
      conversation_id: input.conversationId ?? null,
      booking_id: input.bookingId ?? null,
      amount_cents: input.amountCents ?? null,
      currency: input.currency ?? null,
      payload: input.payload ?? {},
    })
    .select(PENDING_ACTION_COLUMNS)
    .single();
  if (error) throw error;
  return toPendingAction(data);
}

export async function getPendingAction(db: Db, id: string): Promise<PendingAction | null> {
  const { data, error } = await db.from("pending_actions").select(PENDING_ACTION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toPendingAction(data) : null;
}

/** A pro's pending actions, newest first. */
export async function listPendingActions(
  db: Db,
  proId: string,
  opts: { status?: PendingActionStatus; limit?: number } = {},
): Promise<PendingAction[]> {
  let query = db.from("pending_actions").select(PENDING_ACTION_COLUMNS).eq("pro_id", proId);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (error) throw error;
  return data.map(toPendingAction);
}

/**
 * The human decision: flips a pending action once (the pro's own client, or the service client for a WhatsApp
 * button reply). The money moves in app code only after this returns ok. Never called by the model.
 */
export async function decidePendingAction(
  db: Db,
  id: string,
  decision: "confirmed" | "cancelled",
): Promise<Result<PendingAction, "not_found" | "not_pending">> {
  const { data, error } = await db.rpc("decide_pending_action", { p_id: id, p_decision: decision });
  if (error) return err(dbError(error, ["P0002", "KT032"]));
  return ok(toPendingAction(data));
}

/** Records what the app did after the decision (refund id, invoice id, error). */
export async function setPendingActionResult(db: Db, id: string, result: Json): Promise<void> {
  await db.from("pending_actions").update({ result }).eq("id", id).throwOnError();
}
