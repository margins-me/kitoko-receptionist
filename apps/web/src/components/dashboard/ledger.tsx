"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import type { ColDef, GridApi, ICellRendererParams, IRowNode, ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { formatMoney } from "./model";
import type { MoneyRow } from "./model";
import { formatClock, formatDay } from "./time";

// The Money tab's ledger: every PayPal payment, refund and payout of the week in an AG Grid (Community, MIT).
// Sort, search, filter by type, a live total of what is shown, CSV export for her accountant. The assistant can
// filter it too ("show me this week's refunds"): its filter arrives as `filter` and shows as a chip she can clear.

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  foregroundColor: "#161616",
  backgroundColor: "#FFFFFF",
  headerBackgroundColor: "#F7F5F2",
  headerFontWeight: 600,
  accentColor: "#C98A3B",
  borderColor: "#E8E3DC",
  rowHoverColor: "#FBF7F1",
  wrapperBorderRadius: 12,
  spacing: 6,
  browserColorScheme: "light",
});

export type LedgerFilter = { type?: MoneyRow["type"] | null; status?: string | null; client?: string | null; by?: "assistant" };

const TYPES: { id: MoneyRow["type"] | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "payment", label: "Payments" },
  { id: "refund", label: "Refunds" },
  { id: "payout", label: "Payouts" },
];
const TYPE_LABEL: Record<MoneyRow["type"], string> = { payment: "Payment", refund: "Refund", payout: "Payout" };
const STATUS_TONE: Record<string, string> = {
  captured: "bg-ink text-on-inverse",
  succeeded: "bg-ink text-on-inverse",
  sent: "bg-honey text-ink",
  pending: "bg-honey text-ink",
  created: "bg-soft text-body",
  approved: "bg-soft text-body",
  refunded: "bg-soft text-muted",
  failed: "bg-danger text-on-danger",
  denied: "bg-danger text-on-danger",
  unclaimed: "bg-error-bg text-error",
};

/** Signed amount as shown: refunds count against her money. */
const signed = (r: MoneyRow) => (r.type === "refund" ? -r.amountCents : r.amountCents);
/** What the total row adds up: payments minus refunds, or the payouts alone when she looks at those (they are the same
 * money leaving to her PayPal, so they never add to the net). */
const counted = (r: MoneyRow, type: MoneyRow["type"] | null | undefined) => (type === "payout" ? r.type === "payout" : r.type !== "payout");

type Row = MoneyRow & { pinned?: string };

export function Ledger({
  rows,
  timeZone,
  filter,
  onFilter,
}: {
  rows: MoneyRow[];
  timeZone: string;
  filter: LedgerFilter;
  onFilter: (f: LedgerFilter) => void;
}) {
  const api = useRef<GridApi<Row> | null>(null);
  const [total, setTotal] = useState<Row[]>([]);
  const currency = rows[0]?.currency ?? "EUR";

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: "When",
        field: "at",
        sort: "desc",
        width: 128,
        valueFormatter: (p: ValueFormatterParams<Row, number>) => (p.node?.rowPinned || p.value == null ? "" : `${formatDay(p.value, timeZone)} ${formatClock(p.value, timeZone)}`),
      },
      {
        headerName: "Type",
        field: "type",
        width: 108,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.node.rowPinned ? null : <span className="font-semibold">{p.data ? TYPE_LABEL[p.data.type] : ""}</span>,
      },
      {
        headerName: "Client",
        field: "clientName",
        width: 150,
        // The total row's label runs over Booking and Detail, which it leaves empty.
        colSpan: (p) => (p.node?.rowPinned ? 3 : 1),
        valueFormatter: (p) => (p.node?.rowPinned ? (p.data?.pinned ?? "") : (p.value ?? "—")),
      },
      { headerName: "Booking", field: "ref", width: 104, cellClass: "font-mono text-muted" },
      { headerName: "Detail", field: "detail", flex: 1, minWidth: 160 },
      {
        headerName: "Amount",
        colId: "amount",
        valueGetter: (p) => (p.data ? (p.node?.rowPinned ? p.data.amountCents : signed(p.data)) : 0),
        type: "rightAligned",
        width: 116,
        comparator: (a: number, b: number) => a - b,
        valueFormatter: (p: ValueFormatterParams<Row, number>) => (p.value == null ? "" : `${p.value < 0 ? "−" : ""}${formatMoney(Math.abs(p.value), currency)}`),
        cellClass: (p) => ["font-semibold tabular-nums", (p.value ?? 0) < 0 ? "text-danger" : ""],
      },
      {
        headerName: "Status",
        field: "status",
        width: 116,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.node.rowPinned || !p.value ? null : (
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${STATUS_TONE[p.value as string] ?? "bg-soft text-body"}`}>{p.value as string}</span>
          ),
      },
      {
        headerName: "PayPal ID",
        field: "paypalId",
        width: 190,
        cellClass: "font-mono text-[12px] text-muted",
        valueFormatter: (p) => (p.node?.rowPinned ? "" : p.value ? (String(p.value).startsWith("SEED-") ? "demo seed" : String(p.value)) : "—"),
      },
    ],
    [timeZone, currency],
  );

  // The total row follows whatever is shown: her filter, the assistant's, or the search box.
  const retotal = useCallback(() => {
    const grid = api.current;
    if (!grid) return;
    let net = 0;
    let n = 0;
    grid.forEachNodeAfterFilter((node: IRowNode<Row>) => {
      if (!node.data) return;
      n += 1;
      if (counted(node.data, filter.type)) net += signed(node.data);
    });
    const label = filter.type === "payout" ? "Payouts" : "Net (payments − refunds)";
    setTotal([{ id: "total", type: "payment", bookingId: "", ref: null, clientName: null, amountCents: net, currency, status: "", detail: "", at: 0, paypalId: null, pinned: `${label} · ${n} row${n === 1 ? "" : "s"}` }]);
  }, [currency, filter.type]);

  const passes = useCallback(
    (node: IRowNode<Row>) => {
      const r = node.data;
      if (!r) return true;
      if (filter.type && r.type !== filter.type) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.client && !(r.clientName ?? "").toLowerCase().includes(filter.client.toLowerCase())) return false;
      return true;
    },
    [filter],
  );
  const active = Boolean(filter.type || filter.status || filter.client);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex rounded-full bg-surface p-1">
          {TYPES.map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={(filter.type ?? null) === t.id}
              onClick={() => onFilter({ ...filter, type: t.id, by: undefined })}
              className={`min-h-8 rounded-full px-3 text-caption font-semibold ${(filter.type ?? null) === t.id ? "bg-ink text-on-inverse" : "text-body"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={filter.client ?? ""}
          onChange={(e) => onFilter({ ...filter, client: e.target.value || null, by: undefined })}
          placeholder="Client…"
          aria-label="Filter by client"
          className="min-h-9 w-36 rounded-full border border-hairline bg-surface px-3 text-caption"
        />
        {filter.by === "assistant" && active && (
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-honey bg-surface px-3 text-caption font-semibold">
            ✦ Filtered by your assistant
            <button type="button" aria-label="Clear the filter" onClick={() => onFilter({})} className="text-muted">
              ×
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={() => api.current?.exportDataAsCsv({ fileName: "kitoko-ledger.csv", skipPinnedBottom: true })}
          className="ml-auto min-h-9 rounded-full border border-outline px-3 text-caption font-semibold"
        >
          Export CSV
        </button>
      </div>
      <div style={{ height: Math.min(520, 112 + rows.length * 42) }}>
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          getRowId={(p) => `${p.data.type}-${p.data.id}`}
          defaultColDef={{ sortable: true, resizable: true }}
          isExternalFilterPresent={() => active}
          doesExternalFilterPass={passes}
          pinnedBottomRowData={total}
          onGridReady={(e) => {
            api.current = e.api;
            retotal();
          }}
          onModelUpdated={retotal}
          onFilterChanged={retotal}
          suppressCellFocus
          overlayNoRowsTemplate="Nothing matches."
        />
      </div>
    </div>
  );
}
