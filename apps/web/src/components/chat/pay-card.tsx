"use client";

import { useEffect, useState } from "react";
import { buttonStyles, cn } from "@kitoko/ui";
import { Ban, Check, Clock, MessageCircle, TimerOff } from "@kitoko/ui/icons";
import { getPayState } from "@/app/[locale]/pay/[id]/actions";
import { asLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/routing";
import { formatLeft, HOLD_SECONDS, holdLeft, money, viewOf } from "@/components/pay/format";
import type { PayState } from "@/components/pay/types";

// The card under a reply that carries a deposit link (/pay/<id>): what to pay now, the hold's live countdown with the
// pay page's honey fuse, then Paid / Expired / Cancelled as the booking moves on. Its words follow the BOOKING's
// language (the one the client writes in), not the page's. Same height in every state: the chat never jumps.

const POLL_MS = 5000;

type Copy = {
  toPay: string;
  paid: string;
  total: string;
  held: string;
  pay: string;
  confirmed: string;
  expired: string;
  newSlot: string;
  cancelled: string;
  refunded: string;
  view: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    toPay: "To pay now",
    paid: "Paid",
    total: "Deposit and fee",
    held: "Slot held",
    pay: "Pay the deposit",
    confirmed: "Paid · Confirmed",
    expired: "This slot is no longer held",
    newSlot: "Ask for a new slot",
    cancelled: "Booking cancelled",
    refunded: "Cancelled · Refunded",
    view: "View booking",
  },
  fr: {
    toPay: "À payer maintenant",
    paid: "Payé",
    total: "Acompte et frais",
    held: "Créneau réservé",
    pay: "Payer l’acompte",
    confirmed: "Payé · Confirmé",
    expired: "Ce créneau n’est plus réservé",
    newSlot: "Demander un autre créneau",
    cancelled: "Réservation annulée",
    refunded: "Annulée · Remboursée",
    view: "Voir la réservation",
  },
  it: {
    toPay: "Da pagare ora",
    paid: "Pagato",
    total: "Acconto e costo",
    held: "Posto riservato",
    pay: "Paghi l’acconto",
    confirmed: "Pagato · Confermato",
    expired: "Questo posto non è più riservato",
    newSlot: "Chieda un altro orario",
    cancelled: "Prenotazione annullata",
    refunded: "Annullata · Rimborsata",
    view: "Vedi la prenotazione",
  },
  es: {
    toPay: "A pagar ahora",
    paid: "Pagado",
    total: "Señal y gastos",
    held: "Hora reservada",
    pay: "Pagar la señal",
    confirmed: "Pagado · Confirmada",
    expired: "Esta hora ya no está reservada",
    newSlot: "Pedir otra hora",
    cancelled: "Reserva cancelada",
    refunded: "Cancelada · Reembolsada",
    view: "Ver la reserva",
  },
  pt: {
    toPay: "A pagar agora",
    paid: "Pago",
    total: "Sinal e taxa",
    held: "Horário reservado",
    pay: "Pagar o sinal",
    confirmed: "Pago · Confirmada",
    expired: "Este horário já não está reservado",
    newSlot: "Pedir outro horário",
    cancelled: "Marcação cancelada",
    refunded: "Cancelada · Reembolsada",
    view: "Ver a marcação",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The booking id in a deposit link: /pay/<id> or /<locale>/pay/<id>, absolute or not. */
export function payBookingId(href: string): string | null {
  const id = /^(?:\/[a-z]{2})?\/pay\/([^/?#]+)/.exec(pathOf(href))?.[1] ?? null;
  // While the reply streams, the link grows: ask the server only once the id is whole.
  return id && UUID.test(id) ? id : null;
}

/**
 * The link's path, query and hash: the card navigates on this site whatever origin the server wrote (SITE_URL may be
 * another port in dev, or another deployment). WhatsApp and MCP keep the absolute URL.
 */
export function pathOf(href: string): string {
  if (href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    return url.pathname + url.search + url.hash;
  } catch {
    return href;
  }
}

export function PayCard({ href, pageLocale, onAskNewSlot }: { href: string; pageLocale: string; onAskNewSlot: () => void }) {
  const bookingId = payBookingId(href);
  const path = pathOf(href);
  const [state, setState] = useState<PayState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const status = state?.booking.status ?? null;

  // On mount, then every 5 s while the booking is held (the payment may land in another tab, or the hold lapse).
  useEffect(() => {
    if (!bookingId || (status !== null && status !== "held")) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden" && status !== null) return;
      getPayState(bookingId)
        .then((next) => {
          if (alive && next) setState(next);
        })
        .catch(() => undefined);
    };
    if (status === null) load();
    const poll = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [bookingId, status]);

  useEffect(() => {
    if (status !== "held") return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);

  const lang = asLocale(state?.booking.locale ?? pageLocale);
  const c = COPY[lang];
  const view = state ? viewOf(state, now) : null;
  const b = state?.booking;
  const amount = b ? money(b.depositCents + b.feeCents, b.locale, b.currency) : null;
  const refunded = state?.payment?.status === "refunded";
  const left = b ? holdLeft(b, now) : 0;

  return (
    <div lang={lang} className="flex w-full max-w-[86%] flex-col gap-2.5 rounded-card border border-hairline bg-surface p-3 shadow-raise">
      <div className="flex h-7 items-baseline justify-between gap-3 px-1">
        <span className="truncate text-caption text-muted">{view === "confirmed" ? c.paid : view === "held" || view === null ? c.toPay : c.total}</span>
        {amount ? (
          <strong className="text-lead font-bold tabular-nums">{amount}</strong>
        ) : (
          <span aria-hidden className="h-5 w-16 self-center rounded-full bg-soft motion-safe:animate-pulse" />
        )}
      </div>

      {/* One status line, always 40 px: the countdown and its fuse, or where the booking went. */}
      <div
        role={view === "held" ? "timer" : "status"}
        aria-live={view === "held" ? "off" : "polite"}
        className={cn(
          "relative flex h-10 items-center gap-2 overflow-hidden rounded-input px-3 text-caption font-semibold",
          view === "held" && (left <= 120 ? "bg-warning text-ink" : "bg-soft text-ink"),
          view === "confirmed" && "bg-success/10 text-success",
          view === "expired" && "bg-soft text-body",
          view === "cancelled" && "bg-error-bg text-error",
          view === null && "bg-soft motion-safe:animate-pulse",
        )}
      >
        {view === "held" && (
          <>
            <Clock aria-hidden className="size-4 shrink-0" />
            <span className="tabular-nums">
              {c.held} · {formatLeft(left)}
            </span>
            <span aria-hidden className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-current/10">
              <span
                className="block h-full origin-left rounded-full bg-honey transition-transform duration-1000 ease-linear motion-reduce:transition-none"
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, left / HOLD_SECONDS))})` }}
              />
            </span>
          </>
        )}
        {view === "confirmed" && (
          <>
            <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.6} />
            <span>{c.confirmed}</span>
          </>
        )}
        {view === "expired" && (
          <>
            <TimerOff aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{c.expired}</span>
          </>
        )}
        {view === "cancelled" && (
          <>
            <Ban aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{refunded ? c.refunded : c.cancelled}</span>
          </>
        )}
      </div>

      {view === "expired" ? (
        <button type="button" onClick={onAskNewSlot} className={cn(buttonStyles({ size: "md", fullWidth: true }), "rounded-full")}>
          <MessageCircle aria-hidden className="size-5 shrink-0" />
          {c.newSlot}
        </button>
      ) : (
        <a
          href={path}
          className={cn(buttonStyles({ size: "md", fullWidth: true, variant: view === "held" || view === null ? "primary" : "outline" }), "rounded-full")}
        >
          {view === "held" || view === null ? c.pay : c.view}
        </a>
      )}
    </div>
  );
}
