"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, ArrowUp, LoaderCircle } from "@kitoko/ui/icons";
import { useChat } from "./use-chat";

// The WhatsApp simulator: the same receptionist on the WhatsApp channel (30-minute holds, the pay link as a message,
// choices as reply buttons), in WhatsApp's look. Nothing goes to a real phone: the server gives this browser a +999
// number no one has, and the replies are read back from the conversation's rows like the web chat's.

const URL_RE = /(https?:\/\/[^\s<>()"'`{}[\]]+[^\s<>().,;:!?"'`{}[\]*])/g;

/** WhatsApp's own formatting of a reply: [label](url) → label: url, **bold** → bold, links tappable. */
function WaText({ text }: { text: string }) {
  const flat = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => (label === url ? url : `${label}: ${url}`));
  const out: ReactNode[] = [];
  flat.split(URL_RE).forEach((part, k) => {
    if (k % 2 === 1) {
      out.push(
        <a key={k} href={part} target="_blank" rel="noreferrer" className="break-all text-[#027EB5] underline">
          {part}
        </a>,
      );
      return;
    }
    part.split(/\*\*?([^*\n]+)\*\*?/g).forEach((bit, j) => out.push(j % 2 === 1 ? <strong key={`${k}-${j}`}>{bit}</strong> : bit));
  });
  return <>{out}</>;
}

/** Meta takes 3 reply buttons of 20 characters at most; otherwise the text alone goes (it lists the options). */
const asButtons = (choices: string[] | undefined) =>
  choices && choices.length <= 3 && choices.every((c) => c.length <= 20) ? choices : null;

const clock = (iso: string | null) =>
  new Date(iso ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function WhatsAppSim({ handle, locale, proName, backHref }: { handle: string; locale: string; proName: string; backHref: string }) {
  const chat = useChat({ handle, locale, open: true, whatsapp: true });
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const last = chat.messages.at(-1);

  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, last]);

  const submit = (text: string) => {
    if (chat.streaming || !text.trim()) return;
    setDraft("");
    void chat.send(text);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[440px] flex-col bg-[#EFEAE2] text-[15px] text-[#111B21] sm:my-6 sm:h-[min(860px,calc(100dvh-48px))] sm:overflow-hidden sm:rounded-[28px] sm:shadow-xl">
      <header className="flex items-center gap-3 bg-[#008069] px-3 py-2.5 text-white">
        <a href={backHref} aria-label="Back to the page" className="inline-flex size-9 items-center justify-center rounded-full">
          <ArrowLeft aria-hidden className="size-5" />
        </a>
        <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full bg-white/20 font-semibold">
          {proName.charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold leading-tight">{proName}</span>
          <span className="truncate text-[13px] text-white/80">{chat.streaming ? "typing…" : "Business account · AI front desk"}</span>
        </span>
      </header>

      <div ref={list} className="flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        <p className="mx-auto mb-3 max-w-[340px] rounded-lg bg-[#FFF3C4] px-3 py-2 text-center text-[12.5px] leading-snug text-[#54656F]">
          WhatsApp simulator: the same front desk on its WhatsApp channel. Holds last 30 minutes and the PayPal link
          comes as a message. Nothing is sent to a real phone.
        </p>
        {chat.messages.length === 0 && !chat.restoring && (
          <div className="flex flex-col items-center gap-2 pt-6">
            {["Ciao! Box braids sabato?", "Hi! Are you free on Saturday?", "Bonjour, des tresses samedi ?"].map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="rounded-full bg-white px-4 py-2 text-[14px] text-[#008069] shadow-sm">
                {s}
              </button>
            ))}
          </div>
        )}
        <ul className="flex flex-col gap-1.5">
          {chat.messages.map((m) => {
            const mine = m.role === "user";
            const buttons = !mine && m === last ? asButtons(m.choices) : null;
            if (!mine && !m.text) return null;
            return (
              <li key={m.key} className={mine ? "flex justify-end" : "flex flex-col items-start"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm ${mine ? "rounded-tr-none bg-[#D9FDD3]" : "rounded-tl-none bg-white"}`}
                >
                  <WaText text={m.text} />
                  <span className="float-right mt-1.5 ml-2 text-[11px] text-[#667781]">
                    {clock(m.createdAt)}
                    {mine && <span className={m.failed ? "text-red-600" : "text-[#53BDEB]"}> {m.failed ? "!" : "✓✓"}</span>}
                  </span>
                </div>
                {buttons && (
                  <div className="mt-1 flex w-[85%] max-w-[85%] flex-col gap-1">
                    {buttons.map((b) => (
                      <button key={b} type="button" onClick={() => submit(b)} disabled={chat.streaming} className="rounded-lg bg-white py-2 text-center text-[14px] font-medium text-[#027EB5] shadow-sm">
                        {b}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 px-2 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
        <label htmlFor="wa-input" className="sr-only">
          Message
        </label>
        <input
          id="wa-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          autoComplete="off"
          maxLength={2000}
          className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base outline-none"
        />
        <button type="submit" aria-label="Send" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#00A884] text-white">
          {chat.streaming ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <ArrowUp aria-hidden className="size-5" strokeWidth={2.4} />}
        </button>
      </form>
    </div>
  );
}
