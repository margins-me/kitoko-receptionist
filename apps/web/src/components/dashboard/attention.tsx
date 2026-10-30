"use client";

import { Countdown } from "./chip";
import { formatMoney, lookOf, moneyIssue } from "./model";
import type { CalBooking, PendingActionRow } from "./model";
import { formatClock, formatDay } from "./time";

type Item =
  | { kind: "action"; id: string; action: PendingActionRow }
  | { kind: "booking"; id: string; booking: CalBooking; reason: "displaced" | "held" | "proposed" | "balance_due"; proposed?: number }
  | { kind: "booking"; id: string; booking: CalBooking; reason: "money"; issue: string };

const ORDER = { action: 0, money: 1, displaced: 2, proposed: 3, held: 4, balance_due: 5 } as const;

/**
 * What needs the pro: money to confirm, refunds and payouts that did not go through, displaced clients, proposals
 * waiting, live holds, balances to collect.
 */
export function attentionItems(bookings: CalBooking[], actions: PendingActionRow[], proposals: Record<string, number>, hasPayoutEmail = true): Item[] {
  const items: Item[] = actions.map((action) => ({ kind: "action", id: action.id, action }));
  for (const b of bookings) {
    const look = lookOf(b);
    const issue = moneyIssue(b, hasPayoutEmail);
    if (issue) items.push({ kind: "booking", id: `m-${b.id}`, booking: b, reason: "money", issue });
    if (look === "displaced") items.push({ kind: "booking", id: b.id, booking: b, reason: "displaced" });
    else if (look === "held" && b.holdExpiresAt && b.holdExpiresAt > Date.now()) items.push({ kind: "booking", id: b.id, booking: b, reason: "held" });
    else if (look === "balance_due") items.push({ kind: "booking", id: b.id, booking: b, reason: "balance_due" });
    const proposed = proposals[b.id];
    if (proposed !== undefined && (look === "confirmed" || look === "unpaid" || look === "displaced"))
      items.push({ kind: "booking", id: `p-${b.id}`, booking: b, reason: "proposed", proposed });
  }
  return items.toSorted((a, b) => ORDER[a.kind === "action" ? "action" : a.reason] - ORDER[b.kind === "action" ? "action" : b.reason]);
}

export function Attention({
  items,
  timeZone,
  onOpenBooking,
  onOpenAction,
}: {
  items: Item[];
  timeZone: string;
  onOpenBooking: (bookingId: string) => void;
  onOpenAction: (actionId: string) => void;
}) {
  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-2 px-4 pt-4 pb-3">
      <h2 id="attention-title" className="flex items-center gap-2 text-ui font-bold">
        Needs your attention
        {items.length > 0 && <span className="rounded-full bg-honey px-1.5 text-[12px] leading-5 font-bold text-ink tabular-nums">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="text-caption text-muted">All clear. New holds, displaced clients and money to confirm show up here.</p>
      ) : (
        <ul className="flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto">
          {items.map((item) => {
            if (item.kind === "action") {
              const a = item.action;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenAction(a.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-input border border-honey bg-surface px-3 py-2 text-left hover:bg-stone"
                  >
                    <span className="min-w-0">
                      <span className="block text-[12px] font-bold text-muted uppercase">To confirm · {a.kind}</span>
                      <span className="block truncate text-caption font-semibold">{a.summary}</span>
                    </span>
                    {a.amountCents !== null && a.currency && <span className="shrink-0 text-caption font-bold tabular-nums">{formatMoney(a.amountCents, a.currency)}</span>}
                  </button>
                </li>
              );
            }
            const b = item.booking;
            const when = `${formatDay(b.start, timeZone)} ${formatClock(b.start, timeZone)}`;
            const tone =
              item.reason === "displaced" || item.reason === "money"
                ? "border-dashed border-danger bg-error-bg"
                : item.reason === "held"
                  ? "border-honey bg-surface"
                  : item.reason === "proposed"
                    ? "border-dashed border-honey bg-surface"
                    : "border-hairline bg-surface";
            const label =
              item.reason === "money" ? (
                item.issue
              ) : item.reason === "displaced" ? (
                "Waiting for client"
              ) : item.reason === "held" && b.holdExpiresAt ? (
                <>
                  Hold expires in <Countdown until={b.holdExpiresAt} />
                </>
              ) : item.reason === "proposed" && item.proposed !== undefined ? (
                `Proposed ${formatDay(item.proposed, timeZone)} ${formatClock(item.proposed, timeZone)}`
              ) : (
                `Balance due ${formatMoney(b.balanceCents, b.currency)}`
              );
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenBooking(b.id)}
                  className={`flex w-full flex-col rounded-input border px-3 py-2 text-left hover:brightness-[0.98] ${tone}`}
                >
                  <span className={`text-[12px] font-bold uppercase ${item.reason === "displaced" || item.reason === "money" ? "text-danger" : "text-muted"}`}>{label}</span>
                  <span className="truncate text-caption font-semibold">
                    {b.clientName ?? "Slot on hold"} · {b.serviceName}
                  </span>
                  <span className="text-[12px] text-muted">{when}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
