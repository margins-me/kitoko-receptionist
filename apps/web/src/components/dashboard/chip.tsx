"use client";

import { useEffect, useState } from "react";
import { lookLabel, lookOf } from "./model";
import type { CalBooking, Look } from "./model";
import { formatCountdown } from "./time";

const LOOK_CLASS: Record<Look, string> = {
  held: "bg-honey text-ink",
  confirmed: "bg-ink text-on-inverse",
  unpaid: "border border-ink text-ink",
  displaced: "border border-dashed border-danger bg-error-bg text-danger",
  cancelled: "bg-soft text-muted line-through",
  balance_due: "border-2 border-honey text-ink",
  done: "bg-stone text-body",
  no_show: "bg-stone text-body",
  expired: "bg-soft text-muted",
};

/** A second-by-second "12:41" until `until`. */
export function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{formatCountdown(until, now)}</span>;
}

/** The deposit status of a booking, the same words and colours as the calendar. */
export function StatusChip({ booking, className = "" }: { booking: CalBooking; className?: string }) {
  const look = lookOf(booking);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[12px] leading-5 font-bold whitespace-nowrap ${LOOK_CLASS[look]} ${className}`}
    >
      {look === "held" && booking.holdExpiresAt ? (
        <>
          Held · <Countdown until={booking.holdExpiresAt} />
        </>
      ) : (
        lookLabel(booking)
      )}
    </span>
  );
}

/** A small honey dot that pulses while Realtime is connected. */
export function LiveDot({ state }: { state: "connecting" | "live" | "offline" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-semibold" aria-live="polite">
      <span className="relative flex size-2.5">
        {state === "live" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-honey opacity-60 motion-reduce:hidden" />}
        <span className={`relative inline-flex size-2.5 rounded-full ${state === "live" ? "bg-honey" : state === "connecting" ? "bg-outline" : "bg-danger"}`} />
      </span>
      {state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Offline"}
    </span>
  );
}
