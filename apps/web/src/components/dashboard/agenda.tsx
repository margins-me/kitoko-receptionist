"use client";

import { StatusChip } from "./chip";
import { lookOf } from "./model";
import type { CalBlock, CalBooking } from "./model";
import { addDays, dayKey, formatClock, formatDay } from "./time";

/** Phones: the week as a list per day, same status chips as the calendar. */
export function Agenda({
  weekStart,
  timeZone,
  bookings,
  blocks,
  proposals,
  flash,
  onOpen,
}: {
  weekStart: number;
  timeZone: string;
  bookings: CalBooking[];
  blocks: CalBlock[];
  proposals: Record<string, number>;
  flash: Record<string, number>;
  onOpen: (bookingId: string) => void;
}) {
  const today = dayKey(Date.now(), timeZone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, timeZone));
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      {days.map((day) => {
        const key = dayKey(day, timeZone);
        const next = addDays(day, 1, timeZone);
        const items = bookings.filter((b) => b.start >= day && b.start < next);
        const dayBlocks = blocks.filter((b) => b.start < next && b.end > day);
        return (
          <section key={key} aria-label={formatDay(day, timeZone)} className="flex flex-col gap-2">
            <h2 className={`text-caption font-bold uppercase ${key === today ? "text-ink" : "text-muted"}`}>
              {formatDay(day, timeZone)}
              {key === today && <span className="ml-2 rounded-full bg-honey px-1.5 py-0.5 text-[11px] text-ink normal-case">Today</span>}
            </h2>
            {dayBlocks.map((block) => (
              <div key={block.id} className="rounded-input border border-outline bg-soft px-3 py-2 text-caption text-body">
                Blocked · {block.label ?? "Unavailable"} · {formatClock(Math.max(block.start, day), timeZone)}–{formatClock(Math.min(block.end, next), timeZone)}
              </div>
            ))}
            {items.length === 0 && dayBlocks.length === 0 && <p className="text-caption text-muted">No bookings.</p>}
            {items.map((b) => {
              const look = lookOf(b);
              const proposed = proposals[b.id];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpen(b.id)}
                  className={`flex items-start gap-3 rounded-input bg-surface px-3 py-2.5 text-left shadow-raise ${
                    (flash[b.id] ?? 0) > Date.now() ? "ring-2 ring-honey" : ""
                  } ${look === "cancelled" || look === "expired" ? "opacity-60" : ""}`}
                >
                  <span className="w-12 shrink-0 pt-0.5 text-caption font-bold tabular-nums">{formatClock(b.start, timeZone)}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={`truncate text-ui font-semibold ${look === "cancelled" ? "line-through" : ""}`}>
                      {b.clientName ?? "Slot on hold"} <span className="font-normal text-muted">· {b.serviceName}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusChip booking={b} />
                      {proposed !== undefined && (
                        <span className="rounded-full border border-dashed border-honey px-2 text-[12px] leading-5 font-bold">
                          Proposed {formatClock(proposed, timeZone)}
                        </span>
                      )}
                      <span className="text-[12px] text-muted">
                        {b.language} · {b.staffName}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
