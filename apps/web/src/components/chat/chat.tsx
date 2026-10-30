"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { buttonStyles, cn, Sheet, useIsDesktop } from "@kitoko/ui";
import { ArrowUp, CornerDownRight, ExternalLink, Globe, LoaderCircle, RotateCcw } from "@kitoko/ui/icons";
import { PayCard } from "./pay-card";
import { parseRichText, plainText } from "./rich-text";
import type { ChatLink } from "./rich-text";
import { useChat } from "./use-chat";
import type { ChatMessage } from "./use-chat";

// The web chat on the pro's page: the mobile bar's button, and the sheet (bottom sheet on phones, right panel from
// 860 px) it opens. Booking links elsewhere on the page (<a data-booking href="…#chat">, ?service=<id> on a service
// row) and a #chat or #chat?service=<id> address open it too.

export type ChatAvatar = { src: string; srcSet?: string };
export type ChatService = { id: string; name: string };

export type ChatProps = {
  handle: string;
  locale: string;
  label: string;
  className?: string;
  proName: string;
  avatar: ChatAvatar | null;
  /** Her services in the page's language, for the prefill ("I'd like …") and the example openers. */
  services: ChatService[];
};

/** Tools the receptionist runs, each with its "…" label (chat.json tools.*). */
const TOOL_LABELS = [
  "list_services",
  "get_availability",
  "hold_slot",
  "create_deposit_link",
  "list_my_bookings",
  "reschedule_booking",
  "cancel_booking",
  "handoff_to_pro",
] as const;

/** The languages the receptionist speaks, each with a sample first message (chat.json world.*) in its own language. */
const WORLD = ["en", "fr", "it", "es", "pt"] as const;
const NATIVE: Record<(typeof WORLD)[number], string> = { en: "English", fr: "Français", it: "Italiano", es: "Español", pt: "Português" };

/** The other languages, the visitor's browser languages first: one tap sends a sample message in that language. */
function useOtherLanguages(locale: string) {
  const [order, setOrder] = useState<readonly (typeof WORLD)[number][]>(WORLD);
  useEffect(() => {
    const preferred = navigator.languages.map((l) => l.slice(0, 2).toLowerCase());
    const rank = (l: string) => (preferred.includes(l) ? preferred.indexOf(l) : preferred.length);
    setOrder(WORLD.toSorted((a, b) => rank(a) - rank(b)));
  }, []);
  return order.filter((l) => l !== locale);
}

/** Distance from the bottom under which new content keeps the list scrolled to the end. */
const STICK_PX = 96;

export function Chat({ handle, locale, label, className, proName, avatar, services }: ChatProps) {
  const t = useTranslations("chat");
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const focusOnOpen = useRef(false);
  const chat = useChat({ handle, locale, open });

  const openWith = useCallback(
    (serviceId: string | null) => {
      const service = serviceId ? services.find((s) => s.id === serviceId) : undefined;
      if (service) setDraft(t("prefill", { service: service.name }));
      focusOnOpen.current = Boolean(service);
      setOpen(true);
    },
    [services, t],
  );

  // Booking links anywhere on the page open the chat instead of following their #chat href.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-booking]") : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const url = new URL(link.href);
      openWith(url.searchParams.get("service") ?? new URLSearchParams(url.hash.split("?")[1] ?? "").get("service"));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openWith]);

  // #chat in the address (a shared link, a booking link opened in a new tab): open, then drop it so a reload or the
  // sheet's back entry does not open it again.
  useEffect(() => {
    const fromHash = () => {
      const url = new URL(window.location.href);
      if (!url.hash.startsWith("#chat")) return;
      const service = new URLSearchParams(url.hash.split("?")[1] ?? "").get("service") ?? url.searchParams.get("service");
      url.hash = "";
      url.searchParams.delete("service");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
      openWith(service);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [openWith]);

  // The composer takes focus on desktop, and on phones when a service prefilled it (the keyboard is then wanted).
  useEffect(() => {
    if (!open || !(isDesktop || focusOnOpen.current)) return;
    const id = setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 320);
    return () => clearTimeout(id);
  }, [open, isDesktop]);

  const submit = (text: string) => {
    if (chat.streaming || !text.trim()) return;
    setDraft("");
    void chat.send(text);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit(draft);
  };

  const canSend = !chat.streaming && draft.trim() !== "";

  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => openWith(null)}>
        {label}
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        closeLabel={t("close")}
        title={
          <span className="flex items-center gap-3">
            <Avatar avatar={avatar} name={proName} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-lead leading-tight font-semibold">{proName}</span>{" "}
              <span className="flex min-w-0 items-center gap-1.5 text-caption font-normal tracking-normal text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                <span className="truncate">{t("subtitle")}</span>
              </span>
            </span>
          </span>
        }
        footer={
          <form onSubmit={onSubmit} className="flex w-full items-end gap-2">
            <label htmlFor="chat-input" className="sr-only">
              {t("inputLabel")}
            </label>
            <textarea
              id="chat-input"
              ref={input}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("placeholder")}
              enterKeyHint="send"
              autoComplete="off"
              maxLength={2000}
              // Fixed height: the sheet never jumps while typing; a long message scrolls inside.
              className="h-12 min-w-0 flex-1 resize-none rounded-full border border-field bg-surface px-4.5 py-[11px] text-base leading-6 text-ink [scrollbar-width:none] placeholder:text-placeholder focus-visible:border-ink focus-visible:outline-none"
            />
            <button
              type="submit"
              aria-label={t("send")}
              aria-disabled={!canSend}
              className={cn(
                "inline-flex size-12 shrink-0 items-center justify-center rounded-full transition-colors",
                canSend ? "bg-brand text-on-brand" : "bg-hairline text-muted",
              )}
            >
              {chat.streaming ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <ArrowUp aria-hidden className="size-5" strokeWidth={2.4} />}
            </button>
          </form>
        }
      >
        <Conversation
          t={t}
          locale={locale}
          proName={proName}
          services={services}
          chat={chat}
          onPick={(text) => submit(text)}
          onAskNewSlot={() => input.current?.focus()}
        />
      </Sheet>
    </>
  );
}

type Translate = ReturnType<typeof useTranslations<"chat">>;

function Avatar({ avatar, name, small }: { avatar: ChatAvatar | null; name: string; small?: boolean }) {
  const size = small ? "size-7 text-caption" : "size-10 text-ui";
  if (avatar) {
    return <img src={avatar.src} srcSet={avatar.srcSet} alt="" className={cn("shrink-0 rounded-full bg-soft object-cover", size)} />;
  }
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-soft font-semibold text-ink", size)}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Conversation({
  t,
  locale,
  proName,
  services,
  chat,
  onPick,
  onAskNewSlot,
}: {
  t: Translate;
  locale: string;
  proName: string;
  services: ChatService[];
  chat: ReturnType<typeof useChat>;
  onPick: (text: string) => void;
  onAskNewSlot: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { messages, streaming, tools, restoring } = chat;
  const last = messages.at(-1);

  // New content keeps the list at its end, unless the reader scrolled up; sending always brings it back.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (last?.role === "user" && last.id === null) stick.current = true;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, tools, last]);

  const empty = messages.length === 0 && !restoring;
  const service = services[0]?.name;
  const languages = useOtherLanguages(locale);

  return (
    <div
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      }}
      // Stable height: 88 dvh minus the sheet's header, footer and padding on phones, the panel's free height on
      // desktop. Messages scroll in here, so the sheet never grows with the conversation.
      className="-mx-4 flex h-[calc(88dvh-176px)] flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-2 desk:-mx-6 desk:h-auto desk:min-h-0 desk:flex-1 desk:px-6"
    >
      {restoring && (
        <p className="m-auto flex items-center gap-2 text-ui text-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("restoring")}
        </p>
      )}

      {empty && (
        <div className="flex flex-col gap-4">
          <Bubble role="assistant">{t("greeting", { name: proName })}</Bubble>
          <div className="flex flex-col gap-2">
            <p id="chat-openers" className="text-caption text-muted">
              {t("try")}
            </p>
            <ul aria-labelledby="chat-openers" className="flex flex-wrap gap-2">
              {openers(t, locale, service).map((o) => (
                <li key={o.text}>
                  <button
                    type="button"
                    lang={o.lang}
                    onClick={() => onPick(o.text)}
                    className="inline-flex min-h-11 items-center rounded-[22px] border border-hairline bg-surface px-4 py-2 text-left text-ui leading-snug text-ink transition-colors hover:border-outline hover:bg-soft"
                  >
                    {o.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p id="chat-languages" className="flex items-center gap-2 text-caption text-muted">
              <Globe aria-hidden className="size-4 shrink-0" />
              {t("anyLanguage")}
            </p>
            <ul aria-labelledby="chat-languages" className="flex flex-wrap gap-1.5">
              {languages.map((lang) => (
                <li key={lang}>
                  <button
                    type="button"
                    lang={lang}
                    onClick={() => onPick(t(`world.${lang}`, { service: service ?? t("world.fallback") }))}
                    className="inline-flex min-h-10 items-center rounded-full border border-hairline px-3 text-caption text-body transition-colors hover:border-outline hover:bg-soft"
                  >
                    {NATIVE[lang]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {messages.map((m, i) => (
        <MessageRow
          key={m.key}
          message={m}
          t={t}
          locale={locale}
          proName={proName}
          streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
          onRetry={() => chat.retry(m.key)}
          onAskNewSlot={onAskNewSlot}
        />
      ))}

      {!streaming && last?.role === "assistant" && last.choices && last.choices.length > 0 && (
        // Under the receptionist's message, left-aligned and in the accent: answers to tap, never mistaken for the client's own bubbles.
        <div className="flex flex-col items-start gap-1.5">
          <p id="chat-choices" className="text-caption text-muted">
            {t("tapToReply")}
          </p>
          <ul aria-labelledby="chat-choices" className="flex flex-wrap gap-2">
            {last.choices.map((choice) => (
              <li key={choice}>
                <button
                  type="button"
                  onClick={() => onPick(choice)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[22px] border-[1.5px] border-brand bg-surface py-2 pr-4 pl-3 text-left text-ui font-semibold leading-snug text-brand transition-colors hover:bg-soft"
                >
                  <CornerDownRight aria-hidden className="size-4 shrink-0" />
                  {choice}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {streaming && tools.length > 0 && (
        <ul aria-label={t("working")} className="flex flex-col items-start gap-1.5">
          {[...new Set(tools)].map((name) => (
            <li key={name} className="inline-flex min-h-8 items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-caption text-body">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {toolLabel(t, name, proName)}
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {plainText(chat.announcement)}
      </p>
    </div>
  );
}

function openers(t: Translate, locale: string, service: string | undefined): { text: string; lang: string }[] {
  return [
    { lang: locale, text: t("openers.free") },
    ...(service ? [{ lang: locale, text: t("openers.price", { service }) }, { lang: locale, text: t("openers.book", { service }) }] : []),
    { lang: locale, text: t("openers.services") },
  ];
}

function toolLabel(t: Translate, name: string, proName: string): string {
  return (TOOL_LABELS as readonly string[]).includes(name) ? t(`tools.${name as (typeof TOOL_LABELS)[number]}`, { name: proName }) : t("tools.other");
}

function Bubble({ role, children, busy }: { role: "user" | "assistant"; children: ReactNode; busy?: boolean }) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn(
        "max-w-[86%] rounded-[20px] px-4 py-2.5 text-ui leading-snug break-words",
        role === "user" ? "self-end rounded-br-md bg-brand text-on-brand" : "self-start rounded-bl-md bg-soft text-ink",
      )}
    >
      {children}
    </div>
  );
}

function MessageRow({
  message,
  t,
  locale,
  proName,
  streaming,
  onRetry,
  onAskNewSlot,
}: {
  message: ChatMessage;
  t: Translate;
  locale: string;
  proName: string;
  streaming: boolean;
  onRetry: () => void;
  onAskNewSlot: () => void;
}) {
  const { role, text } = message;
  if (role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Bubble role="user">
          <span className="whitespace-pre-wrap">{text}</span>
        </Bubble>
        {message.failed && (
          <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-1.5 px-1 text-caption font-semibold text-error">
            <RotateCcw aria-hidden className="size-3.5" />
            {t("notSent")}
          </button>
        )}
      </div>
    );
  }

  if (!text) {
    return (
      <Bubble role="assistant" busy>
        <span className="sr-only">{t("typing", { name: proName })}</span>
        <span aria-hidden className="flex h-5 items-center gap-1">
          {[0, 160, 320].map((delay) => (
            <span key={delay} className="size-1.5 rounded-full bg-muted motion-safe:animate-pulse" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
      </Bubble>
    );
  }

  const rich = parseRichText(text);
  return (
    <div className="flex flex-col items-start gap-2">
      {rich.lines.length > 0 && (
        <Bubble role="assistant" busy={streaming}>
          {rich.lines.map((line, i) => (
            <span key={i} className={cn("block", line.length === 0 || line.every((r) => !r.text.trim()) ? "h-2" : undefined)}>
              {line.map((run, j) => (run.bold ? <strong key={j} className="font-semibold">{run.text}</strong> : <span key={j}>{run.text}</span>))}
            </span>
          ))}
        </Bubble>
      )}
      {rich.links.map((link) =>
        link.pay ? <PayCard key={link.href} href={link.href} pageLocale={locale} onAskNewSlot={onAskNewSlot} /> : <LinkButton key={link.href} link={link} />,
      )}
    </div>
  );
}

const sameSite = (href: string) => href.startsWith("/") || (typeof window !== "undefined" && new URL(href).origin === window.location.origin);

function LinkButton({ link }: { link: ChatLink }) {
  const internal = sameSite(link.href);
  const label = link.label ?? (internal ? link.href : new URL(link.href).hostname.replace(/^www\./, ""));
  return (
    <a
      href={link.href}
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(buttonStyles({ variant: "outline", size: "sm" }), "max-w-[86%] rounded-full")}
    >
      <span className="truncate">{label}</span>
      {!internal && <ExternalLink aria-hidden className="size-4 shrink-0" />}
    </a>
  );
}
