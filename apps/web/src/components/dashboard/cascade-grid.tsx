"use client";

import { useEffect, useMemo } from "react";
import type { Ref, RefObject } from "react";
import { StringHelper } from "@bryntum/scheduler";
import type { Grid, GridColumnConfig, Model, Store } from "@bryntum/scheduler";
import { BryntumGrid } from "@bryntum/scheduler-react";
import { lookOf } from "./model";
import type { CalBooking, CascadeOffer } from "./model";
import { formatClock, formatDay } from "./time";

// The sick-day cascade's "unplaced" bookings in a Bryntum Grid beside the Scheduler: every booking a block displaced,
// with the times the receptionist offered, until the client picks one (moved) or the refund (cancelled). A row can be
// dragged onto a highlighted start in the Scheduler (Bryntum's drag-from-grid pattern, see calendar.tsx).

export type CascadeRow = {
  id: string;
  client: string;
  language: string;
  service: string;
  /** Where it was booked (epoch ms). */
  was: number;
  durationMs: number;
  offered: number[];
  /** The start the pro proposed herself (dragged from this grid or in the calendar), until the client answers. */
  proposed: number | null;
  /** When the receptionist wrote to the client (the offers were logged). */
  askedAt: number | null;
};

/** The displaced bookings of the week, oldest appointment first. */
export function cascadeRows(bookings: readonly CalBooking[], offers: Record<string, CascadeOffer>, proposals: Record<string, number>): CascadeRow[] {
  return bookings
    .filter((b) => lookOf(b) === "displaced")
    .map((b) => ({
      id: b.id,
      client: b.clientName ?? "Client",
      language: b.language,
      service: b.serviceName,
      was: b.start,
      durationMs: b.end - b.start,
      offered: (offers[b.id]?.starts ?? []).filter((t) => t !== b.start),
      proposed: proposals[b.id] ?? null,
      askedAt: offers[b.id]?.at ?? null,
    }))
    .toSorted((a, b) => a.was - b.was);
}

const encode = (text: string) => StringHelper.encodeHtml(text);
const get = <T,>(record: Model, name: string) => record.get(name) as T;

function columns(timeZone: string): Partial<GridColumnConfig>[] {
  const when = (t: number) => `${formatDay(t, timeZone).replace(/ \S+$/, "")} ${formatClock(t, timeZone)}`;
  return [
    {
      text: "Client",
      field: "client",
      width: 130,
      htmlEncode: false,
      renderer: ({ record }: { record: Model }) =>
        `<span class="kt-cg-client"><i class="fa fa-grip-vertical kt-cg-grip" aria-hidden="true"></i><strong>${encode(get<string>(record, "client"))}</strong></span>`,
    },
    { text: "Service", field: "service", flex: 1, minWidth: 110, htmlEncode: true },
    {
      text: "Was booked",
      field: "was",
      width: 120,
      htmlEncode: false,
      renderer: ({ record }: { record: Model }) => `<span class="kt-cg-was">${encode(when(get<number>(record, "was")))}</span>`,
    },
    {
      text: "Front desk offered",
      field: "offered",
      flex: 1.6,
      minWidth: 220,
      htmlEncode: false,
      renderer: ({ record }: { record: Model }) => {
        const offered = get<number[]>(record, "offered") ?? [];
        const proposed = get<number | null>(record, "proposed");
        if (proposed !== null) return `<span class="kt-cg-chip kt-cg-chip-proposed">${encode(when(proposed))}</span>`;
        if (offered.length === 0) return `<span class="kt-cg-muted">Writing to her…</span>`;
        return offered.map((t) => `<span class="kt-cg-chip">${encode(when(t))}</span>`).join("");
      },
    },
    {
      text: "Status",
      field: "proposed",
      width: 210,
      htmlEncode: false,
      renderer: ({ record }: { record: Model }) => {
        const proposed = get<number | null>(record, "proposed");
        const askedAt = get<number | null>(record, "askedAt");
        if (proposed !== null) return `<span class="kt-cg-status kt-cg-status-proposed">You proposed a time</span>`;
        return `<span class="kt-cg-status">Waiting for her reply</span>${askedAt ? `<span class="kt-cg-muted"> · asked ${formatClock(askedAt, timeZone)}</span>` : ""}`;
      },
    },
    {
      text: "Lang",
      field: "language",
      width: 72,
      align: "center",
      htmlEncode: false,
      renderer: ({ record }: { record: Model }) => `<span class="kt-cg-lang">${encode(get<string>(record, "language"))}</span>`,
    },
  ];
}

export function CascadeGrid({ rows, timeZone, gridRef, onOpen }: { rows: CascadeRow[]; timeZone: string; gridRef: RefObject<BryntumGrid | null>; onOpen: (bookingId: string, anchor: DOMRect) => void }) {
  const config = useMemo(
    () => ({
      columns: columns(timeZone),
      rowHeight: 40,
      readOnly: true,
      animateRemovingRows: true,
      emptyText: "Every client has answered · nothing left to place",
      cellEditFeature: false,
      cellMenuFeature: false,
      headerMenuFeature: false,
      columnReorderFeature: false,
      groupFeature: false,
      sortFeature: false,
      stripeFeature: false,
      cellTooltipFeature: false,
    }),
    [timeZone],
  );

  // Rows are synced in place, so a client's answer animates her row out instead of redrawing the grid.
  useEffect(() => {
    const grid = gridRef.current?.instance as Grid | undefined;
    if (!grid) return;
    const store = grid.store as Store;
    const keep = new Set(rows.map((r) => r.id));
    const gone = store.records.filter((r) => !keep.has(String(r.id)));
    if (gone.length) store.remove(gone);
    for (const row of rows) {
      const existing = store.getById(row.id);
      if (existing) existing.set({ ...row, offered: [...row.offered] });
      else store.add({ ...row });
    }
  }, [rows, gridRef]);

  return (
    <BryntumGrid
      {...config}
      ref={gridRef as unknown as Ref<BryntumGrid>}
      onCellClick={({ record, event }: { record: Model; event: Event }) => {
        const row = event.target instanceof Element ? event.target.closest(".b-grid-row") : null;
        if (row) onOpen(String(record.id), row.getBoundingClientRect());
      }}
    />
  );
}
