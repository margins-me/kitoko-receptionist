"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseHistory, readEvents } from "./stream";
import type { ServerMessage } from "./stream";

// The web chat's state: the conversation token (localStorage), the messages, the streamed reply and its running
// tools, and the 3 s poll that brings proactive messages (payment confirmed, a sick-day move) while the chat is open.

export type ChatMessage = {
  key: string;
  /** Null until the server's copy is known (a message sent or streamed here, before the next sync). */
  id: string | null;
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
  /** A user message the server never got. */
  failed?: boolean;
  /** Tap-to-reply options the receptionist offered with this reply. */
  choices?: string[];
};

const EPOCH = new Date(0).toISOString();
const POLL_MS = 3000;

const storageKey = (handle: string) => `kitoko-chat:${handle}`;

function readToken(handle: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(handle));
  } catch {
    return null;
  }
}

function writeToken(handle: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(storageKey(handle), token);
    else window.localStorage.removeItem(storageKey(handle));
  } catch {
    // Private mode or blocked storage: the conversation just lives as long as the page.
  }
}

let counter = 0;
const nextKey = () => `local-${++counter}`;

const fromServer = (m: ServerMessage): ChatMessage => ({ key: m.id, id: m.id, role: m.role, text: m.text, createdAt: m.createdAt, ...(m.choices ? { choices: m.choices } : {}) });

/**
 * The server's messages laid onto ours. Once the server has the assistant's reply, it replaces the local copies of the
 * exchange (it may have split or trimmed them); before that, a local message with the same text just takes its id.
 */
function merge(prev: ChatMessage[], incoming: ServerMessage[]): ChatMessage[] {
  const known = new Set(prev.flatMap((m) => (m.id ? [m.id] : [])));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return prev;
  if (fresh.some((m) => m.role === "assistant")) {
    return [...prev.filter((m) => m.id !== null || m.failed), ...fresh.map(fromServer)];
  }
  const next = [...prev];
  for (const m of fresh) {
    const local = next.findIndex((l) => l.id === null && !l.failed && l.role === m.role && l.text.trim() === m.text.trim());
    if (local >= 0) next[local] = { ...next[local]!, id: m.id, createdAt: m.createdAt };
    else next.push(fromServer(m));
  }
  return next;
}

const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

/** The WhatsApp simulator's id, made once per browser: the server turns it into the chat's (fake) phone number. */
function simulatorId(): string {
  const make = () => crypto.randomUUID().replaceAll("-", "");
  try {
    const saved = window.localStorage.getItem("kitoko-wa-id");
    if (saved) return saved;
    const id = make();
    window.localStorage.setItem("kitoko-wa-id", id);
    return id;
  } catch {
    return make();
  }
}

/** `whatsapp`: the WhatsApp simulator (same receptionist on the WhatsApp channel), with its own saved conversation. */
export function useChat({ handle: pageHandle, locale, open, whatsapp = false }: { handle: string; locale: string; open: boolean; whatsapp?: boolean }) {
  // The handle keys the saved token; the simulator keeps its own. The handle sent to the server stays the page's.
  const handle = whatsapp ? `wa:${pageHandle}` : pageHandle;
  const sim = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  /** Names of the tools running now, in start order. */
  const [tools, setTools] = useState<string[]>([]);
  /** True from the first open with a saved token until its history arrives (or fails). */
  const [restoring, setRestoring] = useState(false);
  /** The last finished assistant message, for the polite live region. */
  const [announcement, setAnnouncement] = useState("");

  const token = useRef<string | null>(null);
  const cursor = useRef(EPOCH);
  const busy = useRef(false);
  const restored = useRef(false);
  const abort = useRef<AbortController | null>(null);
  /** Server ids already merged, so only new assistant messages are announced. */
  const seen = useRef(new Set<string>());

  const sync = useCallback(async (quiet = false) => {
    const current = token.current;
    if (!current) return;
    try {
      const res = await fetch(`/api/chat?${new URLSearchParams({ token: current, after: cursor.current })}`, { cache: "no-store" });
      if (res.status === 404 || res.status === 410) {
        // The conversation is gone (demo reset): start a new one.
        token.current = null;
        writeToken(handle, null);
        return;
      }
      if (!res.ok) return;
      const incoming = parseHistory(await res.json());
      if (!incoming || incoming.length === 0 || token.current !== current) return;
      // A reply that arrived while streaming is merged by the sync that follows the stream (the cursor stays put).
      if (busy.current) return;
      for (const m of incoming) cursor.current = later(cursor.current, m.createdAt);
      const proactive = incoming.filter((m) => m.role === "assistant" && !seen.current.has(m.id)).at(-1);
      for (const m of incoming) seen.current.add(m.id);
      setMessages((prev) => merge(prev, incoming));
      // quiet: the sync after a stream, whose reply was announced when it finished.
      if (restored.current && !quiet && proactive) setAnnouncement(proactive.text);
    } catch {
      // Offline for a moment: the next poll tries again.
    } finally {
      restored.current = true;
      setRestoring(false);
    }
  }, [handle]);

  // The saved conversation, once, on the first open.
  useEffect(() => {
    if (!open || restored.current) return;
    token.current = readToken(handle);
    if (!token.current) {
      restored.current = true;
      return;
    }
    setRestoring(true);
    void sync();
  }, [open, handle, sync]);

  // Proactive messages while the chat is open.
  useEffect(() => {
    if (!open) return;
    if (restored.current) void sync();
    const id = setInterval(() => {
      if (!busy.current && token.current) void sync();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [open, sync]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy.current) return false;
      busy.current = true;
      const userKey = nextKey();
      const replyKey = nextKey();
      setMessages((prev) => [
        ...prev,
        { key: userKey, id: null, role: "user", text, createdAt: null },
        { key: replyKey, id: null, role: "assistant", text: "", createdAt: null },
      ]);
      setStreaming(true);
      setTools([]);

      const update = (fn: (text: string) => string) =>
        setMessages((prev) => prev.map((m) => (m.key === replyKey ? { ...m, text: fn(m.text) } : m)));

      let received = "";
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            handle: pageHandle,
            token: token.current ?? undefined,
            text,
            locale,
            ...(whatsapp ? { whatsapp: (sim.current ??= simulatorId()) } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
        // Text that resumes after a tool starts a new paragraph, so "Let me check." and the answer do not run together.
        let afterTool = false;
        for await (const event of readEvents(res.body)) {
          if (event.type === "token") {
            token.current = event.token;
            writeToken(handle, event.token);
          } else if (event.type === "text") {
            const gap = afterTool && received && !/\s$/.test(received) ? "\n\n" : "";
            received += gap + event.delta;
            afterTool = false;
            const value = received;
            update(() => value);
          } else if (event.type === "tool") {
            if (event.status === "start") {
              afterTool = true;
              setTools((t) => [...t, event.name]);
            } else {
              setTools((t) => {
                const i = t.indexOf(event.name);
                return i < 0 ? t : [...t.slice(0, i), ...t.slice(i + 1)];
              });
            }
          } else if (event.type === "choices") {
            const choices = event.choices;
            setMessages((prev) => prev.map((m) => (m.key === replyKey ? { ...m, choices } : m)));
          } else if (event.type === "done") {
            break;
          }
        }
        if (!received.trim()) throw new Error("empty reply");
        setAnnouncement(received);
        return true;
      } catch {
        if (controller.signal.aborted) return false;
        // Nothing came back: the message is marked unsent (with a retry). A cut-off reply keeps what arrived.
        if (!received.trim()) {
          setMessages((prev) => prev.filter((m) => m.key !== replyKey).map((m) => (m.key === userKey ? { ...m, failed: true } : m)));
        }
        return false;
      } finally {
        busy.current = false;
        setStreaming(false);
        setTools([]);
        if (!controller.signal.aborted) void sync(true);
      }
    },
    [handle, pageHandle, locale, sync, whatsapp],
  );

  /** Sends an unsent message again. */
  const retry = useCallback(
    (key: string) => {
      const failed = messages.find((m) => m.key === key);
      if (!failed || busy.current) return;
      setMessages((prev) => prev.filter((m) => m.key !== key));
      void send(failed.text);
    },
    [messages, send],
  );

  return { messages, streaming, tools, restoring, announcement, send, retry };
}
