"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  blockTimeAction,
  cancelBookingAction,
  decideActionAction,
  dropTargets,
  fetchBookableTicks,
  fetchMoney,
  fetchWeek,
  markDoneAction,
  proposeMoveAction,
  resetDemoAction,
  signOut,
} from "@/app/dashboard/actions";
import { browserDb } from "@/lib/supabase/browser";
import { Agenda } from "./agenda";
import { Assistant } from "./assistant";
import { Attention, attentionItems } from "./attention";
import { BlockDialog } from "./block-dialog";
import type { BlockDraft } from "./block-dialog";
import { BookingCard } from "./booking-card";
import type { BookingAction } from "./booking-card";
import type { CalendarProps, Zoom } from "./calendar";
import { PICK_HIGHLIGHTED } from "./calendar-layout";
import { LiveDot } from "./chip";
import { bookingMoneyCents, bookingSignature, formatMoney, lookOf } from "./model";
import type { ActionResult, BookableTick, CalBooking, ChatLine, MoneyData, ProSummary, StaffRow, WeekData } from "./model";
import type { LedgerFilter } from "./ledger";
import { MoneyPanel } from "./money-panel";
import { addDays, dayKey, formatClock, formatDay, formatWeek, weekStartOf, zonedParts } from "./time";

// Bryntum is browser-only and heavy: loaded on tablets and desktops only, never on the server.
const Calendar = dynamic<CalendarProps>(() => import("./calendar"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-caption text-muted">Loading the calendar…</div>,
});

const FLASH_MS = 3200;
// agent_events: the times the receptionist offered a displaced client and her tool calls (the ✦) show up live.
const REALTIME_TABLES = ["bookings", "blocks", "payments", "payouts", "pending_actions", "conversation_messages", "agent_events"] as const;

type Toast = { id: number; text: string; tone: "info" | "error" };

function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** What changed between two loads, in the pro's words (the live toast). */
function describeChange(before: CalBooking | undefined, after: CalBooking, tz: string): string | null {
  const who = after.clientName ?? "A client";
  if (!before) return after.status === "held" ? `New hold: ${after.serviceName}, ${formatDay(after.start, tz)} ${formatClock(after.start, tz)}` : `New booking: ${who}, ${formatDay(after.start, tz)} ${formatClock(after.start, tz)}`;
  if (before.start !== after.start) return `${who} moved to ${formatDay(after.start, tz)} ${formatClock(after.start, tz)}`;
  if (before.status === "held" && after.status === "confirmed") return `${who} paid the deposit · booking confirmed`;
  if (before.status !== "cancelled" && after.status === "cancelled") return `${who} cancelled · refund ${formatMoney(after.refundedCents || after.paidCents, after.currency)}`;
  if (!before.displacedAt && after.displacedAt) return `${who} is waiting for a new time`;
  if (before.refundStatus !== "succeeded" && after.refundStatus === "succeeded") return `Refund to ${who} completed`;
  if (before.payoutStatus !== after.payoutStatus && after.payoutStatus === "succeeded") return `Payout for ${who} received`;
  if (before.status === "held" && after.status === "expired") return "A hold expired";
  return null;
}

export function DashboardApp({
  pro,
  staff,
  initialWeek,
  initialChat,
}: {
  pro: ProSummary;
  staff: StaffRow[];
  initialWeek: WeekData;
  initialChat: ChatLine[];
}) {
  const tz = pro.timezone;
  const wide = useWide();
  const [week, setWeek] = useState<WeekData>(initialWeek);
  const [weekStart, setWeekStart] = useState(initialWeek.weekStart);
  // Optimistic proposals (drag → until the server has logged them); the server's come with each week load.
  const [localProposals, setProposals] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<{ id: string; anchor: DOMRect | null } | null>(null);
  const [busy, setBusy] = useState<BookingAction | null>(null);
  const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null);
  const [mainTab, setMainTab] = useState<"calendar" | "money">("calendar");
  const [phoneTab, setPhoneTab] = useState<"agenda" | "assistant" | "money">("agenda");
  const [zoom, setZoom] = useState<Zoom>("day");
  const [focusDay, setFocusDay] = useState(() => addDays(weekStartOf(Date.now(), tz), Math.max(0, zonedParts(Date.now(), tz).weekday - 1), tz));
  const [money, setMoney] = useState<MoneyData | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>({});
  const [moneyLoading, setMoneyLoading] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [deciding, setDeciding] = useState<Record<string, "confirmed" | "cancelled">>({});
  /** Actions decided here: hidden at once, before Realtime brings the refreshed list. */
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [resetting, setResetting] = useState(false);
  const [ticks, setTicks] = useState<BookableTick[]>([]);
  /** Drop targets per booking for the week on screen; cleared whenever the week's data changes. */
  const targets = useRef(new Map<string, Promise<{ start: number; staffIds: string[] }[] | null>>());

  const weekRef = useRef(week);
  const weekStartRef = useRef(weekStart);
  useEffect(() => {
    weekRef.current = week;
    weekStartRef.current = weekStart;
  }, [week, weekStart]);

  const say = useCallback((text: string, tone: Toast["tone"] = "info") => setToast({ id: Date.now() + Math.random(), text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Applies a fresh load: flashes what changed, drops answered proposals, says what happened. */
  const applyWeek = useCallback(
    (next: WeekData, announce: boolean) => {
      const prev = weekRef.current;
      const sameWeek = prev.weekStart === next.weekStart;
      const before = new Map(prev.bookings.map((b) => [b.id, b]));
      const now = Date.now();
      const flashes: Record<string, number> = {};
      let message: string | null = null;
      if (sameWeek) {
        for (const b of next.bookings) {
          const old = before.get(b.id);
          if (!old || bookingSignature(old) !== bookingSignature(b)) {
            flashes[b.id] = now + FLASH_MS;
            message ??= describeChange(old, b, tz);
          }
        }
        const oldBlocks = new Set(prev.blocks.map((b) => b.id));
        for (const block of next.blocks) if (!oldBlocks.has(block.id)) flashes[block.id] = now + FLASH_MS;
      }
      weekRef.current = next;
      setWeek(next);
      targets.current.clear();
      if (Object.keys(flashes).length) {
        setFlash((f) => ({ ...f, ...flashes }));
        setTimeout(() => setFlash((f) => Object.fromEntries(Object.entries(f).filter(([, until]) => until > Date.now()))), FLASH_MS + 100);
      }
      setProposals((p) => {
        const byId = new Map(next.bookings.map((b) => [b.id, b]));
        const kept = Object.fromEntries(
          Object.entries(p).filter(([id, start]) => {
            const b = byId.get(id);
            if (!b) return !sameWeek;
            if (next.proposals[id] !== undefined) return false;
            const look = lookOf(b);
            const old = before.get(id);
            const moved = old !== undefined && old.start !== b.start;
            return !moved && b.start !== start && (look === "confirmed" || look === "unpaid" || look === "displaced");
          }),
        );
        return Object.keys(kept).length === Object.keys(p).length ? p : kept;
      });
      if (announce && message) say(message);
    },
    [say, tz],
  );

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moneyOpen = mainTab === "money" || phoneTab === "money";
  const moneyOpenRef = useRef(moneyOpen);
  useEffect(() => {
    moneyOpenRef.current = moneyOpen;
  }, [moneyOpen]);

  const loadMoney = useCallback(async () => {
    setMoneyLoading(true);
    try {
      const start = weekStartRef.current;
      setMoney(await fetchMoney(start, addDays(start, 7, tz)));
    } catch {
      // keep the last figures
    } finally {
      setMoneyLoading(false);
    }
  }, [tz]);

  /** Bookable starts of the week on screen (at-rest ticks); the last ones stay on a failed load. */
  const loadTicks = useCallback(
    async (start: number) => {
      try {
        const next = await fetchBookableTicks(start, addDays(start, 7, tz));
        if (start === weekStartRef.current) setTicks(next);
      } catch {
        // keep the last ticks
      }
    },
    [tz],
  );

  const loadDropTargets = useCallback(
    (bookingId: string) => {
      const start = weekStartRef.current;
      let pending = targets.current.get(bookingId);
      if (!pending) {
        pending = dropTargets(bookingId, start, addDays(start, 7, tz))
          .then((r) => (r.ok ? r.starts : null))
          .catch(() => null);
        targets.current.set(bookingId, pending);
        // A failed load is asked again on the next drag.
        void pending.then((r) => {
          if (r === null) targets.current.delete(bookingId);
        });
      }
      return pending;
    },
    [tz],
  );

  const refetch = useCallback(
    (announce = true) => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(async () => {
        try {
          const start = weekStartRef.current;
          const next = await fetchWeek(start);
          if (next.weekStart === weekStartRef.current) applyWeek(next, announce);
          void loadTicks(start);
          if (moneyOpenRef.current) void loadMoney();
        } catch {
          setLive("offline");
        }
      }, 250);
    },
    [applyWeek, loadMoney, loadTicks],
  );

  useEffect(() => {
    void loadTicks(weekStart);
  }, [weekStart, loadTicks]);

  // Realtime: her rows only (RLS + pro_id filter). Any change refetches the week through a server action.
  useEffect(() => {
    const supabase = browserDb();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel(`pro-${pro.id}`);
      for (const table of REALTIME_TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `pro_id=eq.${pro.id}` }, () => refetch(true));
      }
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setLive("live");
          refetch(false);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
      });
    })();
    // Safety net while the tab is visible (a dropped socket, an expired hold the cron flips): every 45 s, every 10 s
    // while Realtime is not connected.
    let last = Date.now();
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (liveRef.current === "live" && Date.now() - last < 45_000) return;
      last = Date.now();
      refetch(true);
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [pro.id, refetch]);

  useEffect(() => {
    if (moneyOpen) void loadMoney();
  }, [moneyOpen, weekStart, loadMoney]);

  const goWeek = async (delta: number) => {
    const start = addDays(weekStart, 7 * delta, tz);
    setWeekStart(start);
    weekStartRef.current = start;
    setFocusDay(start);
    setSelected(null);
    try {
      applyWeek(await fetchWeek(start), false);
    } catch {
      say("Could not load that week.", "error");
    }
  };

  const goToday = async () => {
    const start = weekStartOf(Date.now(), tz);
    const today = addDays(start, zonedParts(Date.now(), tz).weekday - 1, tz);
    setFocusDay(today);
    if (start !== weekStart) {
      setWeekStart(start);
      weekStartRef.current = start;
      applyWeek(await fetchWeek(start), false);
    }
  };

  const report = (result: ActionResult, fallback: string) => {
    if (result.ok) say(result.message ?? fallback);
    else say(result.error, "error");
    refetch(false);
  };

  const onBookingAction = async (bookingId: string, action: BookingAction) => {
    setBusy(action);
    try {
      const result = action === "cancel" ? await cancelBookingAction(bookingId) : await markDoneAction(bookingId, action);
      report(result, "Done");
      if (result.ok) setSelected(null);
    } catch {
      say("That did not go through. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const onProposeMove = async (bookingId: string, start: number) => {
    const booking = weekRef.current.bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    setProposals((p) => ({ ...p, [bookingId]: start }));
    const who = booking.clientName ?? "the client";
    say(`Asked ${who} to confirm ${formatDay(start, tz)} ${formatClock(start, tz)} — the calendar moves when she says yes`);
    try {
      const result = await proposeMoveAction(bookingId, start);
      if (!result.ok) {
        setProposals((p) => Object.fromEntries(Object.entries(p).filter(([id]) => id !== bookingId)));
        // Someone took the time meanwhile, or it is not one of her starts: point at the highlights, never "slot unavailable".
        say(/slot|unavailable|taken|blocked/.test(result.error) ? `${PICK_HIGHLIGHTED}: that time is no longer free for ${who}` : `Could not ask ${who}: ${result.error}`, "error");
      }
    } catch {
      setProposals((p) => Object.fromEntries(Object.entries(p).filter(([id]) => id !== bookingId)));
      say(`Could not ask ${who}. Try again.`, "error");
    }
  };

  const onBlock = async (input: { staffId: string | null; from: number; to: number; label: string }) => {
    try {
      const result = await blockTimeAction(input);
      if (!result.ok) {
        say(result.error, "error");
        return false;
      }
      setBlockDraft(null);
      say(result.message ?? "Time blocked");
      refetch(false);
      return true;
    } catch {
      return false;
    }
  };

  const onDecide = async (actionId: string, decision: "confirmed" | "cancelled"): Promise<ActionResult | null> => {
    setDeciding((d) => ({ ...d, [actionId]: decision }));
    try {
      const result = await decideActionAction(actionId, decision);
      if (result.ok) setDecided((d) => new Set(d).add(actionId));
      report(result, "Done");
      return result;
    } catch {
      say("That did not go through. Try again.", "error");
      return null;
    } finally {
      setDeciding((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== actionId)));
    }
  };

  const onReset = async () => {
    if (!window.confirm(`Reset ${pro.name}'s demo week? Every booking, payment and message made since is wiped and the seeded week comes back.`)) return;
    setResetting(true);
    try {
      const result = await resetDemoAction();
      setProposals({});
      report(result, "Demo week restored");
    } finally {
      setResetting(false);
    }
  };

  const openNewBlock = () => {
    const base = Math.max(focusDay, weekStart);
    setBlockDraft({ staffId: null, from: base, to: addDays(base, 1, tz) });
  };

  const proposals = useMemo(() => ({ ...week.proposals, ...localProposals }), [week.proposals, localProposals]);
  const pendingActions = useMemo(() => week.pendingActions.filter((a) => !decided.has(a.id)), [week.pendingActions, decided]);
  const items = useMemo(() => attentionItems(week.bookings, pendingActions, proposals, pro.hasPayoutEmail), [week, pendingActions, proposals, pro.hasPayoutEmail]);
  const selectedBooking = selected ? (week.bookings.find((b) => b.id === selected.id) ?? null) : null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, tz));
  const todayKey = dayKey(Date.now(), tz);
  // The day view's money line: the focused day's appointments, counted like the week's money columns.
  const dayMoney = week.bookings
    .filter((b) => b.start >= focusDay && b.start < addDays(focusDay, 1, tz))
    .reduce(
      (sum, b) => {
        const m = bookingMoneyCents(b);
        return { captured: sum.captured + m.captured, refunded: sum.refunded + m.refunded, paidOut: sum.paidOut + m.paidOut };
      },
      { captured: 0, refunded: 0, paidOut: 0 },
    );

  // ---- pieces ------------------------------------------------------------------------------------------------

  const topBar = (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline bg-surface px-4 py-2.5 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-caption font-bold text-on-inverse">{pro.name.slice(0, 1)}</span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui leading-tight font-bold">{pro.name}</span>
          <span className="truncate text-[12px] text-muted">
            {pro.city ?? "—"} · {pro.currency} · {tz}
          </span>
        </div>
        <span className="hidden md:inline-flex">
          <LiveDot state={live} />
        </span>
      </div>
      <nav className="-mx-2 flex items-center gap-0.5 text-caption font-semibold md:mx-0 md:gap-1.5">
        <a href={`/${pro.handle}`} target="_blank" rel="noreferrer" className="rounded-full px-2 py-2 whitespace-nowrap hover:bg-soft md:px-3">
          <span className="md:hidden">My page ↗</span>
          <span className="hidden md:inline">View my page ↗</span>
        </a>
        <a href="/how-it-works" target="_blank" rel="noreferrer" className="rounded-full px-2 py-2 whitespace-nowrap hover:bg-soft md:px-3">
          How it works ↗
        </a>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="rounded-full border border-outline px-2.5 py-1.5 whitespace-nowrap hover:border-ink disabled:opacity-50 md:px-3 md:py-2"
        >
          {resetting ? "Resetting…" : "Reset demo"}
        </button>
        <form action={signOut}>
          <button type="submit" className="rounded-full px-2 py-2 whitespace-nowrap text-muted hover:bg-soft hover:text-ink md:px-3">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );

  const toastView = toast && (
    <div role="status" className="pointer-events-none fixed inset-x-4 bottom-20 z-60 flex justify-center md:bottom-6">
      <span
        key={toast.id}
        className={`inline-flex max-w-[640px] animate-pop-in items-center gap-2 rounded-full px-4 py-2.5 text-caption font-semibold shadow-toast ${
          toast.tone === "error" ? "bg-danger text-on-danger" : "bg-inverse text-on-inverse"
        }`}
      >
        {toast.tone === "info" && <span className="size-2 shrink-0 rounded-full bg-honey" />}
        {toast.text}
      </span>
    </div>
  );

  const bookingSheet = selectedBooking && (
    <BookingPopover anchor={selected?.anchor ?? null} onClose={() => setSelected(null)}>
      <BookingCard
        key={selectedBooking.id}
        booking={selectedBooking}
        timeZone={tz}
        proposedStart={proposals[selectedBooking.id] ?? null}
        busy={busy}
        onAction={(action) => void onBookingAction(selectedBooking.id, action)}
        onClose={() => setSelected(null)}
      />
    </BookingPopover>
  );

  const blockDialog = blockDraft && (
    <BlockDialog draft={blockDraft} staff={staff} bookings={week.bookings} timeZone={tz} onSubmit={onBlock} onClose={() => setBlockDraft(null)} />
  );

  const assistant = (
    <Assistant
      greetName={staff[0]?.name ?? pro.name}
      initial={initialChat}
      pendingActions={pendingActions}
      deciding={deciding}
      onDecide={onDecide}
      onTurnDone={() => refetch(true)}
      onLedger={(f) => {
        setLedgerFilter({ ...f, by: "assistant" });
        setMainTab("money");
        setPhoneTab("money");
      }}
    />
  );

  const weekNav = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Previous week" onClick={() => void goWeek(-1)} className="grid size-9 place-items-center rounded-full hover:bg-soft">
        ‹
      </button>
      <span className="min-w-0 text-caption font-bold whitespace-nowrap">{formatWeek(weekStart, tz)}</span>
      <button type="button" aria-label="Next week" onClick={() => void goWeek(1)} className="grid size-9 place-items-center rounded-full hover:bg-soft">
        ›
      </button>
      <button type="button" onClick={() => void goToday()} className="ml-1 rounded-full border border-outline px-3 py-1.5 text-caption font-semibold hover:border-ink">
        Today
      </button>
    </div>
  );

  if (wide === null) return <div className="h-dvh" />;

  // ---- phones ------------------------------------------------------------------------------------------------
  if (!wide) {
    return (
      <div className="flex h-dvh flex-col bg-stone">
        {topBar}
        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-surface px-3 py-1.5">
          {weekNav}
          <LiveDot state={live} />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {phoneTab === "agenda" && (
            <>
              {items.length > 0 && (
                <div className="border-b border-hairline bg-surface">
                  <Attention items={items} timeZone={tz} onOpenBooking={(id) => setSelected({ id, anchor: null })} onOpenAction={() => setPhoneTab("assistant")} />
                </div>
              )}
              <Agenda
                weekStart={weekStart}
                timeZone={tz}
                bookings={week.bookings}
                blocks={week.blocks}
                proposals={proposals}
                flash={flash}
                onOpen={(id) => setSelected({ id, anchor: null })}
              />
              <div className="px-4 pb-6">
                <button type="button" onClick={openNewBlock} className="min-h-12 w-full rounded-full border border-outline bg-surface text-ui font-semibold">
                  Block time (sick day…)
                </button>
              </div>
            </>
          )}
          {phoneTab === "assistant" && <div className="flex h-full flex-col bg-surface">{assistant}</div>}
          {phoneTab === "money" && <MoneyPanel data={money} timeZone={tz} loading={moneyLoading} filter={ledgerFilter} onFilter={setLedgerFilter} />}
        </main>
        <nav className="grid grid-cols-3 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Sections">
          {(
            [
              ["agenda", "Agenda"],
              ["assistant", pendingActions.length ? `Assistant (${pendingActions.length})` : "Assistant"],
              ["money", "Money"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={phoneTab === key ? "page" : undefined}
              onClick={() => setPhoneTab(key)}
              className={`min-h-14 text-caption font-semibold ${phoneTab === key ? "text-ink" : "text-muted"}`}
            >
              <span className={`border-b-2 pb-1 ${phoneTab === key ? "border-honey" : "border-transparent"}`}>{label}</span>
            </button>
          ))}
        </nav>
        {bookingSheet}
        {blockDialog}
        {toastView}
      </div>
    );
  }

  // ---- tablets and desktops ----------------------------------------------------------------------------------
  return (
    <div className="flex h-dvh flex-col bg-stone">
      {topBar}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div role="tablist" aria-label="View" className="flex rounded-full bg-surface p-1 shadow-raise">
                {(
                  [
                    ["calendar", "Calendar"],
                    ["money", "Money"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={mainTab === key}
                    onClick={() => setMainTab(key)}
                    className={`rounded-full px-4 py-1.5 text-caption font-semibold ${mainTab === key ? "bg-ink text-on-inverse" : "text-body hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {weekNav}
            </div>
            {mainTab === "calendar" && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-full border border-outline bg-surface p-0.5" role="group" aria-label="Zoom">
                  {(["day", "week"] as const).map((z) => (
                    <button
                      key={z}
                      type="button"
                      aria-pressed={zoom === z}
                      onClick={() => setZoom(z)}
                      className={`rounded-full px-3 py-1 text-caption font-semibold capitalize ${zoom === z ? "bg-soft text-ink" : "text-muted"}`}
                    >
                      {z}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={openNewBlock} className="rounded-full bg-ink px-4 py-2 text-caption font-semibold text-on-inverse">
                  Block time
                </button>
              </div>
            )}
          </div>
          {mainTab === "calendar" && zoom === "day" && (
            <div className="flex gap-1 overflow-x-auto px-4 pb-2" role="group" aria-label="Day">
              {days.map((day) => {
                const key = dayKey(day, tz);
                const count = week.bookings.filter((b) => b.start >= day && b.start < addDays(day, 1, tz) && b.status !== "cancelled").length;
                const active = dayKey(focusDay, tz) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFocusDay(day)}
                    className={`flex shrink-0 flex-col items-start rounded-input px-3 py-1.5 text-left whitespace-nowrap ${active ? "bg-ink text-on-inverse" : "bg-surface text-ink hover:bg-soft"}`}
                  >
                    <span className="text-caption font-bold">
                      {formatDay(day, tz).replace(/ \S+$/, "")}
                      {key === todayKey && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-honey align-middle" />}
                    </span>
                    <span className={`text-[12px] ${active ? "text-on-inverse-muted" : "text-muted"}`}>
                      {count} booking{count === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
              <dl className="ml-auto flex shrink-0 items-center gap-3 self-center pl-3 text-[12px] whitespace-nowrap text-muted" aria-label="Money for this day">
                {(
                  [
                    ["Captured", dayMoney.captured],
                    ["Refunded", dayMoney.refunded],
                    ["Paid out", dayMoney.paidOut],
                  ] as const
                ).map(([label, cents]) => (
                  <div key={label} className="flex items-baseline gap-1">
                    <dt>{label}</dt>
                    <dd className="font-bold text-ink tabular-nums">{formatMoney(cents, pro.currency)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className={`min-h-0 flex-1 px-4 pb-4 ${mainTab === "calendar" ? "" : "hidden"}`}>
            <div className={`kt-calendar kt-zoom-${zoom} h-full overflow-hidden rounded-card bg-surface shadow-raise`}>
              <Calendar
                staff={staff}
                timeZone={tz}
                currency={pro.currency}
                weekStart={weekStart}
                bookings={week.bookings}
                blocks={week.blocks}
                hours={week.hours}
                proposals={proposals}
                flash={flash}
                offers={week.offers}
                agentChanges={week.agentChanges}
                zoom={zoom}
                focusDay={focusDay}
                onSelect={(id, anchor) => setSelected({ id, anchor })}
                onProposeMove={(id, start) => void onProposeMove(id, start)}
                ticks={ticks}
                loadDropTargets={loadDropTargets}
                onDropRejected={(message) => say(message, "error")}
                onBlockRange={(range) => setBlockDraft(range)}
                onAction={(id, action) => void onBookingAction(id, action)}
                onOpenDay={(day) => {
                  setFocusDay(day);
                  setZoom("day");
                }}
              />
            </div>
          </div>
          {mainTab === "money" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MoneyPanel data={money} timeZone={tz} loading={moneyLoading} filter={ledgerFilter} onFilter={setLedgerFilter} />
            </div>
          )}
        </main>
        <aside className="flex min-h-0 flex-col border-l border-hairline bg-surface">
          <div className="border-b border-hairline">
            <Attention
              items={items}
              timeZone={tz}
              onOpenBooking={(id) => setSelected({ id, anchor: null })}
              onOpenAction={(id) => document.getElementById(`action-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            />
          </div>
          {assistant}
        </aside>
      </div>
      {bookingSheet}
      {blockDialog}
      {toastView}
    </div>
  );
}

/** Next to the clicked event on wide screens; a bottom sheet / centred card otherwise. */
function BookingPopover({ anchor, onClose, children }: { anchor: DOMRect | null; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const style = useMemo(() => {
    if (!anchor || typeof window === "undefined") return undefined;
    const width = 360;
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + gap;
    if (left + width > vw - 12) left = anchor.left - width - gap;
    if (left < 12) left = Math.min(Math.max(12, anchor.left), vw - width - 12);
    const top = Math.min(Math.max(12, anchor.top - 20), vh - 560);
    return { left, top: Math.max(12, top), width };
  }, [anchor]);

  return (
    <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {!style && <div className="absolute inset-0 bg-scrim animate-fade-in" aria-hidden />}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Booking"
        style={style}
        className={
          style
            ? "absolute max-h-[calc(100dvh-24px)] animate-pop-in overflow-y-auto rounded-card bg-surface p-5 shadow-modal"
            : "absolute inset-x-0 bottom-0 max-h-[90dvh] animate-pop-in overflow-y-auto rounded-t-sheet bg-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-sheet md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[400px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card"
        }
      >
        {children}
      </div>
    </div>
  );
}
