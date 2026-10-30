"use client";

import { useEffect, useState } from "react";
import type { Timeline, TimelineItem, TimelineResult } from "@/app/how-it-works/load-timeline";

// The live timeline of one booking: polls /how-it-works/data every 3 s (paused while the tab is hidden) with the same
// selector as the page, so the default view follows the newest demo booking as it is made.

const POLL_MS = 3000;

const KIND_LABEL: Record<TimelineItem["kind"], string> = { agent: "Agent", paypal: "PayPal", booking: "Booking", error: "Error" };

const KIND_STYLE: Record<TimelineItem["kind"], { dot: string; badge: string }> = {
  agent: { dot: "bg-ink", badge: "bg-ink text-surface" },
  paypal: { dot: "bg-honey", badge: "bg-tone-2 text-tone-2-fg" },
  booking: { dot: "bg-success", badge: "bg-tone-1 text-tone-1-fg" },
  error: { dot: "bg-danger", badge: "bg-error-bg text-error" },
};

const STATUS_STYLE: Record<string, string> = {
  held: "bg-tone-2 text-tone-2-fg",
  confirmed: "bg-tone-1 text-tone-1-fg",
  honoured: "bg-tone-1 text-tone-1-fg",
  cancelled: "bg-error-bg text-error",
  expired: "bg-soft text-muted",
  no_show: "bg-error-bg text-error",
};

const CHANNEL: Record<string, string> = { web: "Web chat", whatsapp: "WhatsApp", mcp: "MCP (outside AI agent)", manual: "Dashboard" };

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);

const clock = (at: number, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(at);

const when = (at: number, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);

export function LiveTimeline({ initial, query }: { initial: TimelineResult; query: string }) {
  const [result, setResult] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/how-it-works/data${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as TimelineResult;
        if (!cancelled) {
          setResult(next);
          setStale(false);
        }
      } catch {
        if (!cancelled) setStale(true);
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  if (!result.found) return <EmptyState notFound={result.reason === "not_found"} />;
  return <TimelineView timeline={result.timeline} stale={stale} />;
}

function EmptyState({ notFound }: { notFound: boolean }) {
  return (
    <div className="rounded-card border border-dashed border-outline bg-surface p-5 sm:p-8">
      <h3 className="text-lead font-bold">{notFound ? "No booking with that reference" : "No booking yet"}</h3>
      <p className="mt-2 max-w-[36em] text-ui leading-relaxed text-body">
        Make one and watch it appear here within 3 seconds: open{" "}
        <a href="/aicha.braids" className="font-semibold text-ink underline decoration-honey decoration-2 underline-offset-4">
          Aïcha Braids
        </a>
        , ask the front desk for knotless braids on Saturday, and pay the sandbox deposit. Or connect the MCP server
        (<code className="rounded bg-soft px-1 py-0.5 text-caption">/api/mcp</code>) to Claude and ask it to book for you.
      </p>
    </div>
  );
}

function TimelineView({ timeline, stale }: { timeline: Timeline; stale: boolean }) {
  const b = timeline.booking;
  const tz = b.timezone;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Booking" className="rounded-card bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-ui font-bold tracking-wider">{b.ref}</span>
          <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-caption font-semibold ${STATUS_STYLE[b.status] ?? "bg-soft text-body"}`}>
            {b.status}
          </span>
          <span className="inline-flex h-6 items-center rounded-full bg-stone px-2.5 text-caption font-medium text-body">
            {CHANNEL[b.source] ?? b.source}
          </span>
          {timeline.latest && <span className="text-caption text-muted">latest demo booking</span>}
        </div>
        <p className="mt-3 text-lead leading-snug font-semibold">
          {b.service} with {b.staff}
          <span className="font-normal text-body"> · {b.proName}</span>
        </p>
        <p className="mt-1 text-ui text-body">
          {when(b.start, tz)} <span className="text-muted">({tz})</span>
          {b.firstName && <> · for {b.firstName}</>}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-ui sm:grid-cols-4">
          <Amount label="Price" value={money(b.priceCents, b.currency)} />
          <Amount label="Deposit" value={money(b.depositCents, b.currency)} />
          <Amount label="Booking fee" value={money(b.feeCents, b.currency)} />
          <Amount
            label={b.refundedCents > 0 ? "Paid · refunded" : "Paid"}
            value={b.refundedCents > 0 ? `${money(b.paidCents, b.currency)} · ${money(b.refundedCents, b.currency)}` : money(b.paidCents, b.currency)}
          />
        </dl>
      </section>

      <section aria-label="Timeline" className="rounded-card bg-surface p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-ui font-bold">Step by step</h3>
          <span className="inline-flex items-center gap-2 text-caption text-muted" aria-live="polite">
            <span aria-hidden className={`size-2 rounded-full ${stale ? "bg-disabled" : "animate-pulse bg-success"}`} />
            {stale ? "reconnecting…" : "live, every 3 s"}
          </span>
        </div>
        {timeline.items.length === 0 ? (
          <p className="mt-4 text-ui text-body">Nothing logged for this booking yet.</p>
        ) : (
          <ol className="mt-4 flex flex-col">
            {timeline.items.map((item, i) => (
              <Row key={item.id} item={item} tz={tz} last={i === timeline.items.length - 1} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ item, tz, last }: { item: TimelineItem; tz: string; last: boolean }) {
  const style = KIND_STYLE[item.kind];
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-4 bottom-0 left-[5px] w-px bg-hairline" />}
      <span aria-hidden className={`relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-surface ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${style.badge}`}>{KIND_LABEL[item.kind]}</span>
          <span className="min-w-0 font-mono text-[13px] font-semibold break-all text-ink">{item.title}</span>
          {item.verified !== undefined && (
            <span className={`text-caption font-semibold ${item.verified ? "text-success" : "text-danger"}`}>
              {item.verified ? "verified ✓" : "not verified"}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-caption text-muted tabular-nums">
            {typeof item.ms === "number" && <span>{item.ms} ms</span>}
            <time dateTime={new Date(item.at).toISOString()}>{clock(item.at, tz)}</time>
          </span>
        </div>
        {item.input && (
          <p className="mt-1 text-caption leading-snug break-words text-body">
            <span className="text-muted">in </span>
            {item.input}
          </p>
        )}
        {item.output && (
          <p className="mt-0.5 text-caption leading-snug break-words text-body">
            <span className="text-muted">out </span>
            {item.output}
          </p>
        )}
      </div>
    </li>
  );
}
