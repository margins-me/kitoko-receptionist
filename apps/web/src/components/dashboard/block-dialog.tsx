"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { lookOf } from "./model";
import type { CalBooking, StaffRow } from "./model";
import { addDays, dayKey, formatClock, formatDay, zonedParts, zonedToEpoch } from "./time";

export type BlockDraft = { staffId: string | null; from: number; to: number };

const field =
  "min-h-11 w-full rounded-input border border-outline bg-surface px-3 text-ui text-ink outline-none focus-visible:border-ink";

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (epoch: number, tz: string) => {
  const p = zonedParts(epoch, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

function toEpoch(day: string, time: string, tz: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return zonedToEpoch({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(t[1]), minute: Number(t[2]) }, tz);
}

/** Sick day or a break: blocks time for one staff member or the whole studio; the agent rebooks the clients. */
export function BlockDialog({
  draft,
  staff,
  bookings,
  timeZone,
  onSubmit,
  onClose,
}: {
  draft: BlockDraft;
  staff: StaffRow[];
  bookings: CalBooking[];
  timeZone: string;
  onSubmit: (input: { staffId: string | null; from: number; to: number; label: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [who, setWho] = useState<string>(draft.staffId && staff.length > 1 ? draft.staffId : "all");
  const [fromDay, setFromDay] = useState(dayKey(draft.from, timeZone));
  const [fromTime, setFromTime] = useState(timeOf(draft.from, timeZone));
  const [toDay, setToDay] = useState(dayKey(draft.to, timeZone));
  const [toTime, setToTime] = useState(timeOf(draft.to, timeZone));
  const [label, setLabel] = useState("Sick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = toEpoch(fromDay, fromTime, timeZone);
  const to = toEpoch(toDay, toTime, timeZone);
  const valid = from !== null && to !== null && to > from;
  const staffId = who === "all" ? null : who;
  const affected = valid
    ? bookings.filter((b) => {
        const look = lookOf(b);
        return (
          (look === "confirmed" || look === "unpaid" || look === "displaced" || look === "held") &&
          (staffId === null || b.staffId === staffId) &&
          b.start < to &&
          b.end > from
        );
      })
    : [];

  const allDay = () => {
    const midnight = toEpoch(fromDay, "00:00", timeZone);
    if (midnight === null) return;
    setFromTime("00:00");
    setToDay(dayKey(addDays(midnight, 1, timeZone), timeZone));
    setToTime("00:00");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return setError("The end must be after the start.");
    setBusy(true);
    setError(null);
    const done = await onSubmit({ staffId, from: from!, to: to!, label: label.trim() || "Blocked" });
    setBusy(false);
    if (!done) setError("Could not block this time. Try again.");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-scrim p-4 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-title"
        className="flex w-full max-w-[460px] animate-pop-in flex-col gap-4 rounded-sheet bg-surface p-6 shadow-modal"
      >
        <div className="flex flex-col gap-1">
          <h2 id="block-title" className="text-panel-title font-bold">
            Block time
          </h2>
          <p className="text-caption text-muted">
            Sick day, a break, a training. Bookings inside it are marked “Waiting for client” and her assistant offers each client
            new slots — or a full refund.
          </p>
        </div>

        {staff.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">Who</span>
            <select value={who} onChange={(e) => setWho(e.target.value)} className={field}>
              <option value="all">Whole studio</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">From</span>
            <input type="date" required value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold sr-only">From time</span>
            <span aria-hidden className="text-caption">&nbsp;</span>
            <input type="time" required step={900} value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">To</span>
            <input type="date" required value={toDay} onChange={(e) => setToDay(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold sr-only">To time</span>
            <span aria-hidden className="text-caption">&nbsp;</span>
            <input type="time" required step={900} value={toTime} onChange={(e) => setToTime(e.target.value)} className={field} />
          </label>
        </div>
        <button type="button" onClick={allDay} className="-mt-2 self-start text-caption font-semibold underline decoration-honey decoration-2 underline-offset-4">
          Whole day
        </button>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold">Label</span>
          <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={field} />
        </label>

        <div className="rounded-input bg-stone px-3 py-2.5 text-caption">
          {affected.length === 0 ? (
            "No booking inside this time."
          ) : (
            <>
              <strong>
                {affected.length} booking{affected.length === 1 ? "" : "s"} affected
              </strong>
              <ul className="mt-1 flex flex-col gap-0.5 text-body">
                {affected.map((b) => (
                  <li key={b.id}>
                    {formatDay(b.start, timeZone)} {formatClock(b.start, timeZone)} · {b.clientName ?? "hold"} · {b.serviceName}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-input bg-error-bg px-3 py-2 text-caption text-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-outline px-5 text-caption font-semibold">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !valid}
            className="min-h-11 rounded-full bg-ink px-5 text-caption font-semibold text-on-inverse disabled:opacity-50"
          >
            {busy ? "Blocking…" : affected.length > 0 ? `Block & ask ${affected.length} client${affected.length === 1 ? "" : "s"}` : "Block time"}
          </button>
        </div>
      </form>
    </div>
  );
}
