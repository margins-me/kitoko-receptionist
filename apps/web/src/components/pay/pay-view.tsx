"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Alert, buttonStyles, cn, Ticket } from "@kitoko/ui";
import { ChevronLeft, Lock, MessageCircle } from "@kitoko/ui/icons";
import { StatusMark } from "@kitoko/ui/micro/status-mark";
import * as serverActions from "@/app/[locale]/pay/[id]/actions";
import { localePath } from "@/i18n/locale";
import type { Locale } from "@/i18n/routing";
import { ClientDetailsFields, countryOf, useClientDetails } from "./client-details";
import { fixtureActions } from "./fixtures";
import { holdLeft, money, viewOf, when } from "./format";
import { HoldTimer } from "./hold-timer";
import { PayPalButtons } from "./paypal-buttons";
import type { PayActions, PayState, PayView as View } from "./types";

// /[locale]/pay/[id]: what the client pays now and why, the hold's countdown, the PayPal buttons (JS SDK v6), and the
// booking's later states. The server's state is polled every 4 s while held: PayPal's webhook may confirm it first.

const POLL_MS = 4000;
/** createOrder's refusal when "Your details" need fixing: the fields say why, no PayPal notice. */
const DETAILS_ERROR = "client_details";

type Notice = { tone: "error" | "info"; text: string; retry?: boolean } | null;
type Order = { orderId: string; approveUrl: string };

/**
 * What PayPal's redirect said (the return route's ?error= / ?pending=1, PayPal's cancel URL ?cancelled=1): shown once
 * above the buttons, so a declined card or a cancelled approval ends on a "try again", not a silent page.
 */
export type ReturnNotice = "declined" | "error" | "cancelled" | "pending" | null;

export function PayView({
  initial,
  locale,
  serverNow,
  fixture,
  returnNotice = null,
}: {
  initial: PayState;
  locale: Locale;
  serverNow: number;
  fixture: boolean;
  returnNotice?: ReturnNotice;
}) {
  const t = useTranslations("pay");
  const actions: PayActions = useMemo(() => (fixture ? fixtureActions(initial) : serverActions), [fixture, initial]);
  const [state, setState] = useState(initial);
  // Starts on the server's clock so the first render matches the HTML.
  const [now, setNow] = useState(serverNow);
  const [order, setOrder] = useState<Order | null>(null);
  const [orderFailed, setOrderFailed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "capturing" | "pending">(returnNotice === "pending" ? "pending" : "idle");
  const [notice, setNotice] = useState<Notice>(() =>
    returnNotice === "declined"
      ? { tone: "error", text: t("payment.declined") }
      : returnNotice === "error"
        ? { tone: "error", text: t("payment.error") }
        : returnNotice === "cancelled"
          ? { tone: "info", text: t("payment.cancelled") }
          : null,
  );
  const [sdkFailed, setSdkFailed] = useState(false);

  const { booking, paypal } = state;
  const id = booking.id;
  const view = viewOf(state, now);
  const live = booking.status === "held";
  const details = useClientDetails({
    bookingId: id,
    initial: initial.client,
    country: countryOf(booking.timeZone, booking.currency),
    save: actions.saveClientDetails,
  });
  const { commit } = details;

  /** Saves "Your details", then leaves for PayPal's approval page (simulator, or the sandbox fallback link). */
  const leaveFor = useCallback(
    (href: string) => {
      void commit().then((ready) => {
        if (ready) window.location.assign(href);
      });
    },
    [commit],
  );

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);

  const refresh = useCallback(async () => {
    const next = await actions.getPayState(id).catch(() => null);
    if (next) setState(next);
    return next;
  }, [actions, id]);

  // The webhook (or the return page in another tab) may confirm first.
  useEffect(() => {
    if (!live) return;
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(poll);
  }, [live, refresh]);

  useEffect(() => {
    if (view !== "held") setPhase("idle");
  }, [view]);

  // The order is prepared up front: its approval link is the fallback (and the only way in sandbox simulator mode),
  // and the buttons then start their session on an order that already exists.
  const ordering = useRef<Promise<Order> | null>(null);
  const prepare = useCallback((): Promise<Order> => {
    ordering.current ??= actions.createPayPalOrder(id).then((result) => {
      if (!result.ok) throw new Error(result.error);
      const next = { orderId: result.orderId, approveUrl: result.approveUrl };
      setOrder(next);
      setOrderFailed(false);
      return next;
    });
    ordering.current.catch(() => {
      ordering.current = null;
      setOrderFailed(true);
    });
    return ordering.current;
  }, [actions, id]);

  useEffect(() => {
    // A refusal here often means the booking moved on (paid in another tab, expired): re-read it.
    if (view === "held") void prepare().catch(() => void refresh());
  }, [view, prepare, refresh]);

  const onApprove = useCallback(
    async (orderId: string) => {
      setPhase("capturing");
      setNotice(null);
      const result = await actions.capturePayPalOrder(id, orderId).catch(() => ({ ok: false as const, error: "network" }));
      if (!result.ok) {
        setPhase("idle");
        setNotice({ tone: "error", text: result.error === "declined" ? t("payment.declined") : t("payment.error") });
        // The next attempt re-reads the order (PayPal may want a new approval of it, or a new one).
        ordering.current = null;
        void refresh();
        return;
      }
      // confirmed, already_captured: the booking reads confirmed. pending: PayPal holds the funds, the webhook confirms.
      // slot_lost, duplicate: refunded in full, the booking reads expired or confirmed.
      const next = await refresh();
      if (result.status === "pending" || (next && next.booking.status === "held")) setPhase("pending");
    },
    [actions, id, refresh, t],
  );

  const proPath = localePath(`/${booking.proHandle}`, locale);
  const chatHref = `${proPath}#chat`;
  const w = when(booking, locale);
  const cur = booking.currency;
  const toPay = booking.depositCents + booking.feeCents;
  const balance = Math.max(0, booking.priceCents - booking.depositCents);
  const refunded = state.payment?.status === "refunded";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-140 flex-col gap-4 px-4 pt-2 pb-10 desk:max-w-240 desk:px-6 desk:pt-8">
      <nav className="flex min-h-11 items-center justify-between gap-3">
        <a href={proPath} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-ui font-semibold text-ink no-underline">
          <ChevronLeft aria-hidden className="size-5" />
          <span className="truncate">{booking.proName}</span>
        </a>
        <span className="inline-flex items-center gap-1.5 text-caption text-muted">
          <Lock aria-hidden className="size-3.5" />
          {t("secure")}
        </span>
      </nav>

      <header className="flex flex-col gap-1.5">
        <h1 className="text-page-title font-semibold">{t(`title.${view}`)}</h1>
        <p role="status" className="text-ui text-body">
          {refunded && view === "cancelled"
            ? t("lead.refunded")
            : refunded && view === "expired"
              ? t("lead.slotLost")
              : t(`lead.${view}`, { pro: booking.proName })}
        </p>
      </header>

      {/* Phones: one column. Desktop: the ticket and the policy on the left, the timer and the payment beside them. */}
      <div className="flex flex-col gap-4 desk:grid desk:grid-flow-dense desk:grid-cols-[minmax(0,1fr)_400px] desk:items-start desk:gap-x-6">
        {view === "held" && (
          <div className="desk:col-start-2">
            <HoldTimer secondsLeft={holdLeft(booking, now)} />
          </div>
        )}

        <div className="desk:col-start-1 desk:row-span-3 desk:row-start-1">
          <Ticket
            // Slides up once, when the payment confirms it (as Kitoko's confirmation); other states show it still.
            className={view === "confirmed" && initial.booking.status !== "confirmed" ? "motion-safe:animate-ticket-in" : undefined}
            header={
              <div className="flex items-center gap-3.5">
                <div className="flex w-17 shrink-0 flex-col items-center rounded-chip bg-soft py-2">
                  <span className="text-caption text-muted">{w.weekday}</span>
                  <strong className="text-[30px] leading-[1.05] font-bold tracking-display tabular-nums">{w.day}</strong>
                  <span className="text-caption text-muted">{w.month}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <StatusChip view={view} label={t(`status.${view}`)} />
                  <strong className="text-lead leading-tight font-semibold">{booking.serviceName}</strong>
                  <span className="text-ui tabular-nums">
                    {w.date}, {t("ticket.range", { from: w.from, to: w.to })}
                  </span>
                  <span className="truncate text-caption text-muted">
                    {[booking.staffName && t("ticket.with", { staff: booking.staffName }), booking.city].filter(Boolean).join(" · ") || booking.proName}
                  </span>
                </div>
              </div>
            }
          >
            <dl className="flex flex-col gap-1.5 text-ui">
              <Row label={t("ticket.price")} value={money(booking.priceCents, locale, cur)} />
              <Row label={t("ticket.deposit")} value={money(booking.depositCents, locale, cur)} />
              <Row label={t("ticket.fee")} value={money(booking.feeCents, locale, cur)} />
              <Row
                strong
                className="mt-1 border-t border-hairline pt-2"
                label={view === "confirmed" ? t("ticket.paid") : view === "held" ? t("ticket.toPay") : t("ticket.total")}
                value={money(toPay, locale, cur)}
              />
              <Row muted label={t("ticket.balance")} value={money(balance, locale, cur)} />
            </dl>
            <p className="mt-3 flex items-center justify-between gap-3 rounded-input bg-soft px-3 py-2 text-caption text-muted">
              <span>{t("ticket.ref")}</span>
              <strong className="font-mono text-ui tracking-wider text-ink">{booking.ref}</strong>
            </p>
          </Ticket>
        </div>

        {view === "held" && (
          <section aria-labelledby="pay-title" className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-raise desk:col-start-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="pay-title" className="text-lead font-semibold">
                {t("payment.title")}
              </h2>
              <strong className="text-lead font-bold tabular-nums">{money(toPay, locale, cur)}</strong>
            </div>

            {phase !== "pending" && <ClientDetailsFields details={details} proName={booking.proName} disabled={phase === "capturing"} />}

            {phase === "pending" ? (
              <Alert tone="info" className="min-h-29">
                {t("payment.pending")}
              </Alert>
            ) : paypal.mode === "fake" || !paypal.clientId || sdkFailed ? (
              paypal.mode === "fake" || !paypal.clientId ? (
                <SimulatorLink
                  order={order}
                  label={t("payment.simulator")}
                  note={t("payment.simulatorNote")}
                  onFixtureClick={fixture ? () => void commit().then((ready) => (ready ? onApprove("FIXTURE-ORDER") : undefined)) : undefined}
                  onGo={leaveFor}
                  busy={phase === "capturing"}
                  disabled={!details.ready}
                />
              ) : (
                <Alert tone="warning">{t("payment.sdkError")}</Alert>
              )
            ) : (
              <PayPalButtons
                clientId={paypal.clientId}
                currency={cur}
                locale={locale}
                // Her details are saved before PayPal's window opens: the capture confirms the booking with them.
                createOrder={() =>
                  commit()
                    .then((ready) => {
                      if (!ready) throw Object.assign(new Error("details"), { code: DETAILS_ERROR });
                      return prepare();
                    })
                    .then((o) => ({ orderId: o.orderId }))
                }
                onApprove={onApprove}
                onCancel={() => setNotice({ tone: "info", text: t("payment.cancelled") })}
                onError={(code) => {
                  if (code !== DETAILS_ERROR) setNotice({ tone: "error", text: t("payment.error") });
                }}
                onUnavailable={() => setSdkFailed(true)}
                busy={phase === "capturing"}
                disabled={!details.ready}
                loadingLabel={t("payment.loading")}
              />
            )}

            {/* One line, always the same height: what is happening, or what went wrong. */}
            <div aria-live="polite" className="min-h-5 text-caption">
              {phase === "capturing" ? (
                <span className="text-body">{t("payment.capturing")}</span>
              ) : orderFailed ? (
                <span className="text-error">
                  {t("payment.prepareError")}{" "}
                  <button type="button" onClick={() => void prepare().catch(() => undefined)} className="font-semibold underline underline-offset-2">
                    {t("payment.retry")}
                  </button>
                </span>
              ) : notice ? (
                <span className={notice.tone === "error" ? "text-error" : "text-body"}>{notice.text}</span>
              ) : !details.nameOk ? (
                <span className="text-muted">{t("details.needed")}</span>
              ) : paypal.mode === "sandbox" && paypal.clientId ? (
                <span className="text-muted">{t("payment.secure")}</span>
              ) : null}
            </div>

            {paypal.mode === "sandbox" && paypal.clientId && (
              <a
                href={order?.approveUrl ?? undefined}
                aria-disabled={!order || !details.ready}
                onClick={(e) => {
                  e.preventDefault();
                  if (order && details.ready) leaveFor(order.approveUrl);
                }}
                className={cn(
                  "inline-flex min-h-11 items-center self-center px-2 text-caption font-semibold text-muted underline underline-offset-4",
                  (!order || !details.ready) && "pointer-events-none opacity-50",
                )}
              >
                {t("payment.fallback")}
              </a>
            )}
          </section>
        )}

        {view === "confirmed" && (
          <section className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-raise desk:col-start-2">
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-inverse text-on-inverse motion-safe:animate-seal-in">
              <StatusMark status="done" size={24} />
            </span>
            <span className="flex min-w-0 flex-col">
              <strong className="text-ui font-semibold">{t("confirmed.paidTitle")}</strong>
              <span className="text-caption text-muted">{t("confirmed.paidNote", { amount: money(toPay, locale, cur) })}</span>
            </span>
          </section>
        )}

        {view === "expired" && (
          <a href={chatHref} className={cn(buttonStyles({ fullWidth: true }), "rounded-full text-center whitespace-normal desk:col-start-2")}>
            <MessageCircle aria-hidden className="size-5 shrink-0" />
            {t("actions.newSlot")}
          </a>
        )}

        {(view === "confirmed" || view === "cancelled") && (
          <a href={chatHref} className={cn(buttonStyles({ variant: "outline", fullWidth: true }), "rounded-full desk:col-start-2")}>
            <MessageCircle aria-hidden className="size-5 shrink-0" />
            {t("actions.backToChat")}
          </a>
        )}

        {state.policyText && (
          <section aria-labelledby="pay-policy" className="flex flex-col gap-1 px-1 desk:col-start-1">
            <h2 id="pay-policy" className="text-caption font-semibold tracking-[0.06em] text-muted uppercase">
              {t("policy")}
            </h2>
            <p className="text-ui text-body">{state.policyText}</p>
          </section>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, strong, muted, className }: { label: string; value: string; strong?: boolean; muted?: boolean; className?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-bold", muted && "text-muted", className)}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function StatusChip({ view, label }: { view: View; label: string }) {
  const tone: Record<View, string> = {
    held: "bg-warning text-ink",
    confirmed: "bg-inverse text-on-inverse",
    expired: "bg-hairline text-body",
    cancelled: "bg-error-bg text-error",
  };
  return <span className={cn("self-start rounded-full px-2.5 py-0.5 text-xs font-semibold", tone[view])}>{label}</span>;
}

/** PAYPAL_ENV=fake: the PayPal simulator's approval page is the way to pay (the v6 script cannot talk to the fake). */
function SimulatorLink({
  order,
  label,
  note,
  busy,
  disabled,
  onGo,
  onFixtureClick,
}: {
  order: Order | null;
  label: string;
  note: string;
  busy: boolean;
  disabled: boolean;
  /** Follows the approval link once her details are saved. */
  onGo: (href: string) => void;
  onFixtureClick?: () => void;
}): ReactNode {
  const off = !order || busy || disabled;
  return (
    <div className="flex min-h-29 flex-col justify-center gap-2">
      <a
        href={order?.approveUrl ?? undefined}
        aria-disabled={off}
        onClick={(e) => {
          e.preventDefault();
          if (off || !order) return;
          if (onFixtureClick) onFixtureClick();
          else onGo(order.approveUrl);
        }}
        className={cn(buttonStyles({ fullWidth: true, disabled: off }), "rounded-full")}
      >
        {label}
      </a>
      <p className="text-center text-caption text-muted">{note}</p>
    </div>
  );
}
