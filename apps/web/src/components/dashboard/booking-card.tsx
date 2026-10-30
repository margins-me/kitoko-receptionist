"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { StatusChip } from "./chip";
import { formatMoney, lookOf, SOURCE_LABEL } from "./model";
import type { CalBooking } from "./model";
import { formatClock, formatDay } from "./time";

export type BookingAction = "honoured" | "no_show" | "cancel";

const PAYMENT: Record<CalBooking["paymentStatus"], string> = {
  none: "Not paid",
  created: "Checkout started",
  approved: "Approved, capturing",
  captured: "Captured",
  refunded: "Refunded",
  denied: "Denied",
};
const REFUND: Record<CalBooking["refundStatus"], string> = { none: "—", pending: "Pending", succeeded: "Refunded", failed: "Failed" };
const PAYOUT: Record<string, string> = { pending: "Queued", sent: "Sent", succeeded: "Paid out", failed: "Failed", unclaimed: "Unclaimed" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-right text-caption font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Everything about one booking and what the pro can do with it. */
export function BookingCard({
  booking,
  timeZone,
  proposedStart,
  busy,
  onAction,
  onClose,
}: {
  booking: CalBooking;
  timeZone: string;
  proposedStart: number | null;
  busy: BookingAction | null;
  onAction: (action: BookingAction) => void;
  onClose: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const look = lookOf(booking);
  const live = look === "confirmed" || look === "unpaid" || look === "displaced";
  const money = (cents: number) => formatMoney(cents, booking.currency);
  const started = booking.start <= Date.now();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted">
            {formatDay(booking.start, timeZone)} · {formatClock(booking.start, timeZone)}–{formatClock(booking.end, timeZone)} · {booking.staffName}
          </span>
          <h2 className="text-panel-title font-bold">{booking.clientName ?? "Slot on hold"}</h2>
          <span className="text-ui text-body">{booking.serviceName}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-soft hover:text-ink"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip booking={booking} />
        <span className="rounded-full bg-soft px-2 py-0.5 text-[12px] leading-5 font-bold">{booking.language}</span>
        <span className="rounded-full bg-soft px-2 py-0.5 text-[12px] leading-5 font-semibold">{SOURCE_LABEL[booking.source]}</span>
        <span className="rounded-full bg-soft px-2 py-0.5 font-mono text-[12px] leading-5 font-semibold">#{booking.ref}</span>
      </div>

      {proposedStart !== null && (
        <p className="rounded-input border border-dashed border-honey px-3 py-2 text-caption">
          You proposed <strong>{formatDay(proposedStart, timeZone)}, {formatClock(proposedStart, timeZone)}</strong>. Her assistant asked{" "}
          {booking.clientName ?? "the client"}; the calendar moves when she says yes.
        </p>
      )}
      {look === "displaced" && (
        <p className="rounded-input bg-error-bg px-3 py-2 text-caption text-error">
          Displaced by blocked time. Her assistant offered {booking.clientName ?? "the client"} new slots: she moves, or gets a full refund.
        </p>
      )}

      <dl className="flex flex-col divide-y divide-hairline rounded-input bg-stone px-3 py-1">
        <Row label="Price">{money(booking.priceCents)}</Row>
        <Row label="Deposit">{money(booking.depositCents)}</Row>
        <Row label="Booking fee (client)">{money(booking.feeCents)}</Row>
        <Row label="Balance at the salon">{booking.balanceCents > 0 ? `${money(booking.balanceCents)}${booking.balancePaid ? " · paid" : ""}` : "—"}</Row>
        <Row label="PayPal payment">
          {PAYMENT[booking.paymentStatus]}
          {booking.paidCents > 0 ? ` · ${money(booking.paidCents)}` : ""}
        </Row>
        <Row label="Refund">
          {REFUND[booking.refundStatus]}
          {booking.refundedCents > 0 ? ` · ${money(booking.refundedCents)}` : ""}
        </Row>
        <Row label="Payout to you">
          {booking.payoutStatus ? `${PAYOUT[booking.payoutStatus] ?? booking.payoutStatus}${booking.payoutCents !== null ? ` · ${money(booking.payoutCents)}` : ""}` : "—"}
        </Row>
      </dl>

      {live && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onAction("honoured")}
              className="min-h-11 rounded-full bg-ink px-4 text-caption font-semibold text-on-inverse disabled:opacity-50"
            >
              {busy === "honoured" ? "Marking…" : "Mark done"}
            </button>
            <button
              type="button"
              disabled={busy !== null || !started}
              title={started ? undefined : "Available once the appointment has started"}
              onClick={() => onAction("no_show")}
              className="min-h-11 rounded-full border border-outline px-4 text-caption font-semibold disabled:opacity-50"
            >
              {busy === "no_show" ? "Marking…" : "No-show"}
            </button>
          </div>
          {confirmCancel ? (
            <div className="flex flex-col gap-2 rounded-input bg-error-bg p-3">
              <p className="text-caption text-error">
                Cancel and refund {booking.clientName ?? "the client"} in full ({money(booking.paidCents || booking.depositCents + booking.feeCents)}) through PayPal?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onAction("cancel")}
                  className="min-h-11 rounded-full bg-danger px-4 text-caption font-semibold text-on-danger disabled:opacity-50"
                >
                  {busy === "cancel" ? "Refunding…" : "Cancel & refund"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="min-h-11 rounded-full border border-outline bg-surface px-4 text-caption font-semibold"
                >
                  Keep booking
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmCancel(true)}
              className="min-h-11 rounded-full border border-outline px-4 text-caption font-semibold text-danger disabled:opacity-50"
            >
              Cancel (full refund)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
