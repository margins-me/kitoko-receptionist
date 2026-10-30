"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { formatMoney } from "./model";
import type { ActionResult, ChatLine, PendingActionRow } from "./model";

// The pro's assistant: POST /api/chat { kind: "pro", text } with her session cookie, NDJSON back
// ({type:"text",delta} | {type:"tool",name,status} | {type:"done"}). Money actions it prepares come back as pending
// actions (Realtime), rendered as confirm cards: only her button press moves the money.

const SUGGESTIONS = ["What's on this week?", "I'm sick on Friday", "How much did I earn this week?", "Send the balance invoice to my last client"];

const CONFIRM_LABEL: Record<PendingActionRow["kind"], string> = { refund: "Confirm refund", payout: "Send payout", invoice: "Send invoice" };

type Line = ChatLine & { tools?: { name: string; status: string }[]; streaming?: boolean; error?: boolean; receipt?: boolean; link?: { href: string; label: string } };

const CONFIRMED_LABEL: Record<PendingActionRow["kind"], string> = {
  refund: "Refund sent through PayPal",
  payout: "Payout sent through PayPal",
  invoice: "Invoice sent through PayPal",
};

/** **bold** inside a line, as React nodes (never HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/** The assistant writes light Markdown: paragraphs, "- " bullets and **bold**. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      const items = bullets;
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="flex list-disc flex-col gap-1 pl-4">
          {items.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="flex flex-col gap-2">{blocks}</div>;
}

const humanTool = (name: string) => name.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

export function ActionCard({
  action,
  busy,
  onDecide,
}: {
  action: PendingActionRow;
  busy: "confirmed" | "cancelled" | null;
  onDecide: (decision: "confirmed" | "cancelled") => void;
}) {
  return (
    <div id={`action-${action.id}`} className="flex flex-col gap-2.5 rounded-input border border-honey bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption font-semibold">{action.summary}</p>
        {action.amountCents !== null && action.currency && (
          <span className="shrink-0 text-ui font-bold tabular-nums">{formatMoney(action.amountCents, action.currency)}</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onDecide("confirmed")}
          className="min-h-10 flex-1 rounded-full bg-ink px-4 text-caption font-semibold text-on-inverse disabled:opacity-50"
        >
          {busy === "confirmed" ? "Sending…" : CONFIRM_LABEL[action.kind]}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onDecide("cancelled")}
          className="min-h-10 rounded-full border border-outline px-4 text-caption font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Assistant({
  greetName,
  initial,
  pendingActions,
  deciding,
  onDecide,
  onTurnDone,
  onLedger,
}: {
  /** Who the assistant greets (her first staff member: Aïcha, Nala, Kemi). */
  greetName: string;
  initial: ChatLine[];
  pendingActions: PendingActionRow[];
  deciding: Record<string, "confirmed" | "cancelled">;
  onDecide: (actionId: string, decision: "confirmed" | "cancelled") => Promise<ActionResult | null>;
  onTurnDone: () => void;
  /** The assistant filtered the Money ledger (show_money tool). */
  onLedger?: (f: { type?: "payment" | "refund" | "payout" | null; status?: string | null; client?: string | null }) => void;
}) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines, pendingActions.length]);

  const send = async (message: string) => {
    const body = message.trim();
    if (!body || sending) return;
    setText("");
    setSending(true);
    const replyId = `a-${Date.now()}`;
    setLines((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: body, at: Date.now() },
      { id: replyId, role: "assistant", text: "", at: Date.now(), tools: [], streaming: true },
    ]);
    const patch = (fn: (line: Line) => Line) => setLines((prev) => prev.map((l) => (l.id === replyId ? fn(l) : l)));
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pro", text: body }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          let event: { type?: string; delta?: string; name?: string; status?: string; filter?: { type?: "payment" | "refund" | "payout" | null; status?: string | null; client?: string | null } };
          try {
            event = JSON.parse(part) as typeof event;
          } catch {
            continue;
          }
          if (event.type === "text" && event.delta) patch((l) => ({ ...l, text: l.text + event.delta }));
          else if (event.type === "ledger" && event.filter) onLedger?.(event.filter);
          else if (event.type === "tool" && event.name) {
            const name = event.name;
            const status = event.status ?? "running";
            patch((l) => {
              const tools = [...(l.tools ?? [])];
              const i = tools.findIndex((t) => t.name === name && t.status !== "done" && t.status !== "ok");
              if (i >= 0) tools[i] = { name, status };
              else tools.push({ name, status });
              // Text after a tool call starts a new paragraph, not glued to the sentence before it.
              return { ...l, tools, text: l.text && !/\s$/.test(l.text) ? `${l.text}\n` : l.text };
            });
          }
        }
      }
      patch((l) => ({ ...l, streaming: false, text: l.text || (l.tools?.length ? "Done." : "…") }));
    } catch {
      patch((l) => ({ ...l, streaming: false, error: true, text: l.text || "Her assistant is unavailable right now. Try again in a moment." }));
    } finally {
      setSending(false);
      onTurnDone();
    }
  };

  // The card leaves with the pending action; a receipt stays in the conversation.
  const decide = async (action: PendingActionRow, decision: "confirmed" | "cancelled") => {
    const result = await onDecide(action.id, decision);
    if (!result?.ok) return;
    const amount = action.amountCents !== null && action.currency ? ` · ${formatMoney(action.amountCents, action.currency)}` : "";
    const text =
      decision === "cancelled"
        ? `You cancelled: ${action.summary}`
        : `${CONFIRMED_LABEL[action.kind]}${amount} — ${action.summary}${result.detail ? `\n${result.detail}` : ""}`;
    setLines((prev) => [...prev, { id: `r-${action.id}`, role: "assistant", text, at: Date.now(), receipt: true, ...(result.link ? { link: result.link } : {}) }]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  return (
    <section aria-label="Pro assistant" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-ui font-bold">Assistant</h2>
        <span className="text-caption text-muted">Plain language · money needs your tap</span>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {lines.length === 0 && (
          <div className="flex flex-col gap-3 rounded-input bg-stone p-3.5">
            <p className="text-caption text-body">
              Hi {greetName}. Ask me about your week, block a sick day, refund a client or send an invoice. I prepare the
              PayPal action; you confirm it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="min-h-9 rounded-full border border-outline bg-surface px-3 text-caption font-semibold hover:border-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((line) =>
          line.role === "user" ? (
            <p key={line.id} className="max-w-[85%] self-end rounded-[18px] rounded-br-md bg-ink px-3.5 py-2 text-caption text-on-inverse">
              {line.text}
            </p>
          ) : (
            <div key={line.id} className="flex max-w-[92%] flex-col gap-1.5 self-start">
              {line.tools?.map((tool, i) => (
                <span key={`${tool.name}-${i}`} className="inline-flex items-center gap-1.5 self-start rounded-full bg-soft px-2.5 py-0.5 text-[12px] font-semibold text-body">
                  <span className={`size-1.5 rounded-full ${tool.status === "error" ? "bg-danger" : tool.status === "running" || tool.status === "start" ? "animate-pulse bg-honey" : "bg-ink"}`} />
                  {humanTool(tool.name)}
                </span>
              ))}
              {(line.text || line.streaming) && (
                <div
                  className={`rounded-[18px] rounded-bl-md px-3.5 py-2 text-caption ${
                    line.error ? "bg-error-bg text-error" : line.receipt ? "border border-honey bg-surface font-semibold text-ink" : "bg-stone text-ink"
                  }`}
                >
                  {line.text ? <Rich text={line.text} /> : <span className="animate-pulse text-muted">Thinking…</span>}
                  {line.link && (
                    <a href={line.link.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold text-ink underline underline-offset-2">
                      {line.link.label}
                    </a>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {pendingActions.map((action) => (
          <ActionCard key={action.id} action={action} busy={deciding[action.id] ?? null} onDecide={(d) => void decide(action, d)} />
        ))}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-hairline px-3 py-3">
        <label className="sr-only" htmlFor="pro-chat-input">
          Message your assistant
        </label>
        <textarea
          id="pro-chat-input"
          rows={1}
          value={text}
          placeholder="“I’m sick Friday” · “What did I earn?”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-input border border-outline bg-surface px-3 py-2.5 text-ui outline-none focus-visible:border-ink"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="min-h-11 rounded-full bg-ink px-4 text-caption font-semibold text-on-inverse disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
