"use client";

import { Ledger } from "./ledger";
import type { LedgerFilter } from "./ledger";
import { formatMoney } from "./model";
import type { MoneyData } from "./model";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-input bg-surface p-3.5">
      <span className="text-caption text-muted">{label}</span>
      <span className="text-[22px] leading-tight font-bold tabular-nums">{value}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

export function MoneyPanel({
  data,
  timeZone,
  loading,
  filter,
  onFilter,
}: {
  data: MoneyData | null;
  timeZone: string;
  loading: boolean;
  filter: LedgerFilter;
  onFilter: (f: LedgerFilter) => void;
}) {
  if (!data) {
    return <p className="p-6 text-caption text-muted">{loading ? "Loading this week’s money…" : "No data."}</p>;
  }
  const m = (cents: number) => formatMoney(cents, data.currency);
  const { totals } = data;
  return (
    <div className="flex flex-col gap-5 p-4 desk:p-5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Deposits captured" value={m(totals.capturedCents)} hint={`incl. ${m(totals.feesCents)} booking fees (Kitoko)`} />
        <Stat label="Refunded" value={m(totals.refundedCents)} />
        <Stat label="Paid out to you" value={m(totals.paidOutCents)} hint="PayPal Payouts" />
        <Stat label="Payouts queued" value={m(totals.pendingPayoutCents)} />
      </div>

      <p className="-mt-2 text-caption text-muted">
        {data.earningsError
          ? `Totals from your bookings (earnings service unavailable: ${data.earningsError}).`
          : data.paypal
            ? `PayPal Reporting: ${data.paypal.rows} matching transaction${data.paypal.rows === 1 ? "" : "s"}${data.paypal.lastRefreshed ? `, refreshed ${new Date(data.paypal.lastRefreshed).toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" })}` : ""}. Sandbox reporting lags by a few hours.`
            : "PayPal Reporting not available yet (sandbox reporting lags by a few hours); totals come from your bookings."}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-ui font-bold">This week’s payments, refunds and payouts</h3>
        <p className="-mt-1 text-caption text-muted">Sort, filter, export. Ask the assistant “show me this week’s refunds” and it filters this table.</p>
        {data.rows.length === 0 ? (
          <p className="text-caption text-muted">Nothing moved this week yet.</p>
        ) : (
          <Ledger rows={data.rows} timeZone={timeZone} filter={filter} onFilter={onFilter} />
        )}
      </section>
    </div>
  );
}
