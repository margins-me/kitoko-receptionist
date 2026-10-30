"use client";

import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import "./calendar.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import { DomHelper, DragHelper, StringHelper, Tooltip } from "@bryntum/scheduler";
import type { ColumnConfig, DomClassList, EventModel, Grid, Model, ResourceModel, Scheduler, SchedulerConfig, Store } from "@bryntum/scheduler";
import { BryntumGrid, BryntumScheduler } from "@bryntum/scheduler-react";
import {
  axisOf,
  axisSpan,
  buildDependencies,
  buildEvents,
  buildRanges,
  dropLabel,
  dropZones,
  fromAxis,
  offerLabel,
  openLabel,
  PICK_HIGHLIGHTED,
  rowMoney,
  rowsOf,
  rowSummary,
  snapDrop,
  tickRanges,
  zoneRanges,
} from "./calendar-layout";
import type { DependencyData, DropZone, EventData, Kind, RangeData, Row, Tick, Zoom } from "./calendar-layout";
import { CascadeGrid, cascadeRows } from "./cascade-grid";
import { formatMoney, lookLabel, lookOf } from "./model";
import type { AgentChange, CalBlock, CalBooking, CascadeOffer, Currency, OpenHours, StaffRow } from "./model";
import { formatClock, formatCountdown, formatDay } from "./time";

// The pro's week in a Bryntum Scheduler. Rows are days (× staff in a studio), all sharing one 08:00–21:00 axis, so a
// booking reads left to right at its time of day whatever the view: Week = seven day rows, Day = one row per staff.
// Stores are synced in place on every Realtime refetch (no remount), so changed bookings animate to their new slot.

export type { Zoom };

export type CalendarProps = {
  staff: StaffRow[];
  timeZone: string;
  currency: Currency;
  weekStart: number;
  bookings: CalBooking[];
  blocks: CalBlock[];
  /** "yyyy-mm-dd" → her opening hours that day (the rest is shaded). */
  hours: Record<string, OpenHours>;
  /** Booking id → the start the pro proposed by dragging (shown as a ghost until the client answers). */
  proposals: Record<string, number>;
  /** Record id → until when it flashes (changed live). */
  flash: Record<string, number>;
  /** Displaced booking id → the times the receptionist offered its client (dashed ghosts linked by dependency lines). */
  offers: Record<string, CascadeOffer>;
  /** Booking id → what the receptionist changed on the client's answer (✦). */
  agentChanges: Record<string, AgentChange>;
  zoom: Zoom;
  /** Day shown in day zoom (midnight, her zone). */
  focusDay: number;
  onSelect: (bookingId: string, anchor: DOMRect) => void;
  onProposeMove: (bookingId: string, start: number) => void;
  onBlockRange: (range: { staffId: string | null; from: number; to: number }) => void;
  onAction: (bookingId: string, action: "honoured" | "no_show" | "cancel") => void;
  /** A day header clicked in the week: open that day. */
  onOpenDay: (day: number) => void;
  /** Bookable starts at rest (her shortest service fits): small honey ticks. */
  ticks: Tick[];
  /** The starts a booking can be proposed at in the visible week (cached by the caller), null when unknown. */
  loadDropTargets: (bookingId: string) => Promise<{ start: number; staffIds: string[] }[] | null>;
  /** A drop that matches no highlighted start: the booking snaps back and the pro is told why. */
  onDropRejected: (message: string) => void;
};

/** The drag in progress: which booking, its drop zones once loaded, and the last place the validator saw. */
type DragState = {
  bookingId: string;
  zones: DropZone[] | null;
  loading: Promise<DropZone[]>;
  last: { rowId: string; wanted: number; snapped: number | null } | null;
  done: boolean;
};

/** Row heights: a day row in a solo week, a day × staff row in a studio's week, a staff row in the day view. */
const ROW_HEIGHT = { week: 84, studioWeek: 68, day: 116 };
/** The same rows while the cascade grid is open under the Scheduler. */
const CASCADE_ROW_HEIGHT = { week: 64, studioWeek: 60, day: 116 };
/** The narrowest half hour before the axis scrolls instead of squeezing (it stretches to fill when there is room). */
const HALF_HOUR_MIN_WIDTH = 24;

const encode = (text: string) => StringHelper.encodeHtml(text);
/** "14:30" of an axis Date (it carries her wall clock). */
const wall = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

type Mode = "week" | "studioWeek" | "day";
const modeOf = (p: Pick<CalendarProps, "zoom" | "staff">): Mode => (p.zoom === "day" ? "day" : p.staff.length > 1 ? "studioWeek" : "week");

type ResourceData = Row & { name: string; cls: string; summary: string; open: string | null; captured: number; refunded: number; paidOut: number };

function buildResources(p: CalendarProps, rows: Row[]): ResourceData[] {
  const mode = modeOf(p);
  const money = rowMoney(rows, p.bookings, p.timeZone);
  return rows.map((row) => ({
    ...row,
    ...(money.get(row.id) ?? { captured: 0, refunded: 0, paidOut: 0 }),
    name: mode === "day" ? row.staffName : `${row.dayLabel}${p.staff.length > 1 ? ` · ${row.staffName}` : ""}`,
    cls: [row.today && "kt-row-today", mode === "studioWeek" && row.lastOfDay && "kt-row-day-end"].filter(Boolean).join(" "),
    summary: rowSummary(row, p),
    open: openLabel(p.hours[row.dayKey]),
  }));
}

// ---- row headers -----------------------------------------------------------------------------------------------

const field = (record: Model, name: string) => record.get(name) as unknown;

function dayHead(record: Model, withSummary: boolean): string {
  const [dow, ...rest] = String(field(record, "dayLabel")).split(" ");
  const today = field(record, "today") === true;
  const summary = String(field(record, "summary"));
  const quiet = !/booking/.test(summary);
  return `<div class="kt-head${today ? " kt-head-today" : ""}" title="Open this day">
    <div class="kt-head-day"><span class="kt-head-dow">${encode(dow ?? "")}</span><span class="kt-head-date">${encode(rest.join(" "))}</span>${today ? '<span class="kt-head-pill">Today</span>' : ""}</div>
    ${withSummary ? `<div class="kt-head-sub${quiet ? " kt-head-quiet" : ""}">${encode(summary)}</div>` : ""}
  </div>`;
}

function staffHead(record: Model, withHours: boolean): string {
  const summary = String(field(record, "summary"));
  const quiet = !/booking/.test(summary);
  const open = field(record, "open");
  return `<div class="kt-head">
    <div class="kt-staff"><span class="kt-staff-dot" style="background:${encode(String(field(record, "color") ?? "currentColor"))}"></span>${encode(String(field(record, "staffName")))}</div>
    <div class="kt-head-sub${quiet ? " kt-head-quiet" : ""}">${encode(summary)}${withHours && open && summary !== "Closed" ? ` <span class="kt-head-hours">· ${encode(String(open))}</span>` : ""}</div>
  </div>`;
}

/**
 * The week's money per day row in the locked grid: deposits captured, refunded, paid out, by appointment day (the
 * Money tab's figures), with the week's totals in the Summary footer.
 */
function moneyColumns(currency: Currency): Partial<ColumnConfig>[] {
  const cell = (cents: number, cls: string) => (cents ? `<span class="kt-money ${cls}">${formatMoney(cents, currency)}</span>` : '<span class="kt-money kt-money-zero">—</span>');
  return (
    [
      ["captured", "Captured", "kt-money-in"],
      ["refunded", "Refunded", "kt-money-out"],
      ["paidOut", "Paid out", "kt-money-paid"],
    ] as const
  ).map(([field, text, cls]) => ({
    text,
    field,
    width: 94,
    align: "end",
    htmlEncode: false,
    cls: "kt-money-head",
    cellCls: "kt-money-cell",
    renderer: ({ value }: { value: unknown }) => cell(Number(value) || 0, cls),
    sum: "sum",
    summaryRenderer: ({ sum }: { sum: unknown }) => `<span class="kt-money kt-money-total ${cls}">${formatMoney(Number(sum) || 0, currency)}</span>`,
  }));
}

function columnsOf(mode: Mode, currency: Currency): Partial<ColumnConfig>[] {
  if (mode === "week") {
    return [
      {
        text: "Day",
        field: "dayLabel",
        width: 132,
        htmlEncode: false,
        cellCls: "kt-head-cell kt-head-cell-day",
        renderer: ({ record }: { record: Model }) => dayHead(record, true),
        sum: "count",
        summaryRenderer: () => '<span class="kt-money-label">Week</span>',
      },
      ...moneyColumns(currency),
    ];
  }
  if (mode === "studioWeek") {
    return [
      {
        text: "Day",
        field: "dayLabel",
        width: 104,
        htmlEncode: false,
        mergeCells: true,
        cellCls: "kt-head-cell kt-head-cell-day",
        renderer: ({ record }: { record: Model }) => dayHead(record, false),
      },
      { text: "Staff", field: "staffName", width: 116, htmlEncode: false, cellCls: "kt-head-cell", renderer: ({ record }: { record: Model }) => staffHead(record, false) },
      ...moneyColumns(currency),
    ];
  }
  return [{ text: "Staff", field: "staffName", width: 168, htmlEncode: false, cellCls: "kt-head-cell", renderer: ({ record }: { record: Model }) => staffHead(record, true) }];
}

// ---- events ----------------------------------------------------------------------------------------------------

function statusChip(b: CalBooking): string {
  if (lookOf(b) === "held" && b.holdExpiresAt) {
    return `Held · <span class="kt-countdown" data-until="${b.holdExpiresAt}">${formatCountdown(b.holdExpiresAt, Date.now())}</span>`;
  }
  return encode(lookLabel(b));
}

/** Always horizontal: who · service, the time, the status. Container queries drop parts as the bar narrows. */
function eventHtml(who: string, service: string, start: number, end: number, chip: string, timeZone: string, agent = false): string {
  return `<div class="kt-ev-body">
    <div class="kt-ev-line"><span class="kt-ev-who">${agent ? '<span class="kt-ev-agent" aria-label="Changed by your front desk">✦</span>' : ""}${encode(who)}</span><span class="kt-ev-sep"> · </span><span class="kt-ev-svc">${encode(service)}</span></div>
    <div class="kt-ev-foot"><span class="kt-ev-time">${formatClock(start, timeZone)}<span class="kt-ev-end">–${formatClock(end, timeZone)}</span></span><span class="kt-ev-chip">${chip}</span></div>
  </div>`;
}

/** "Moved by your front desk · client said yes · 10:42" (tooltips). */
function agentLine(change: AgentChange | undefined, timeZone: string): string {
  if (!change) return "";
  const what = change.kind === "moved" ? "Moved by your front desk · client said yes" : "Cancelled by your front desk · client chose the refund";
  return `<br><span class="kt-tip-agent">✦ ${encode(what)} · ${formatClock(change.at, timeZone)}</span>`;
}

/** The drag tooltip (a booking dragged in the calendar, or a row dragged from the cascade grid). */
function dragTip(label: string, valid: boolean, hint: string, offer: string | undefined): string {
  return `<div class="kt-tip ${valid ? "kt-tip-ok" : "kt-tip-bad"}"><strong>${encode(label)}</strong>${hint ? `<br>${encode(hint)}` : ""}${offer ? `<br><span class="kt-tip-hint">${encode(offer)}</span>` : ""}</div>`;
}

/** How long an answered offer or proposal takes to fade before it is removed. */
const FADE_MS = 700;

function syncStore(store: Store, next: { id: string }[], fields: (r: { id: string }) => object, stay?: (id: string) => boolean) {
  const keep = new Set(next.map((r) => r.id));
  const gone = store.records.filter((r) => !keep.has(String(r.id)) && !stay?.(String(r.id)));
  if (gone.length) store.remove(gone);
  const added: object[] = [];
  for (const r of next) {
    const existing = store.getById(r.id);
    if (existing) existing.set(fields(r));
    else added.push(r);
  }
  if (added.length) store.add(added);
}

const withoutId = <T extends { id: string }>(r: T): Omit<T, "id"> => {
  const rest: Partial<T> = { ...r };
  delete rest.id;
  return rest as Omit<T, "id">;
};

export default function Calendar(props: CalendarProps) {
  const ref = useRef<BryntumScheduler>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const byId = useMemo(() => new Map(props.bookings.map((b) => [b.id, b])), [props.bookings]);
  const byIdRef = useRef(byId);
  useEffect(() => {
    byIdRef.current = byId;
  }, [byId]);

  // The minute, so the "now" line and today's row move on their own.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));

  /** The layout last applied: a change of rows or axis replaces the stores, anything else updates them in place. */
  const applied = useRef<string | null>(null);
  // Day ↔ week changes the row size and the columns: the scheduler is rebuilt for it (a click, never a Realtime
  // update). Within a view, everything goes through the stores.
  const mode = modeOf(props);
  const rowRef = useRef(new Map<string, Row>());
  /** The event and dependency ids of the last sync (a fade only removes a record that has not come back since). */
  const nextEventIds = useRef(new Set<string>());
  const nextDependencyIds = useRef(new Set<string>());

  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<BryntumGrid>(null);
  /** Offers and proposals fading out after the client answered (removed after FADE_MS). */
  const fadingRef = useRef(new Set<string>());

  /**
   * A drag starts (a booking in the calendar, or a displaced one from the cascade grid): its valid new starts are
   * loaded once and drawn as honey drop zones in its staff member's rows; everything else steps back.
   */
  const startDrag = (booking: CalBooking): DragState | null => {
    const scheduler = ref.current?.instance as Scheduler | undefined;
    if (!scheduler) return null;
    scheduler.element.classList.add("kt-dragging");
    const tz = latest.current.timeZone;
    const loading = latest.current
      .loadDropTargets(booking.id)
      .catch(() => null)
      .then((starts) =>
        dropZones(
          { timeZone: tz },
          (starts ?? []).filter((s) => s.staffIds.includes(booking.staffId)).map((s) => s.start),
          booking.end - booking.start,
          booking.staffId,
        ),
      );
    const state: DragState = { bookingId: booking.id, zones: null, loading, last: null, done: false };
    dragRef.current = state;
    void loading.then((zones) => {
      if (dragRef.current !== state) return;
      state.zones = zones;
      const ids = new Set(rowRef.current.keys());
      (scheduler.resourceTimeRangeStore as Store).add(zoneRanges(latest.current, ids, zones));
    });
    return state;
  };

  /** Clears the drop zones and the dimming once a drag ends, however it ends. */
  const endDrag = () => {
    const scheduler = ref.current?.instance as Scheduler | undefined;
    if (!scheduler) return;
    scheduler.element.classList.remove("kt-dragging", "kt-drop-ok", "kt-drop-bad");
    const store = scheduler.resourceTimeRangeStore as Store;
    const zones = store.records.filter((r) => String(r.id).startsWith("target:"));
    if (zones.length) store.remove(zones);
  };

  /**
   * A drop at `wanted` in `row`: snapped to the start it means (its zone, or the nearest within 45 min), proposed to
   * the client; no start near it: refused with "Pick a highlighted time". Runs once per drag.
   */
  const settleDrop = (row: Row, wanted: number) => {
    const state = dragRef.current;
    if (!state || state.done) return;
    state.done = true;
    const booking = byIdRef.current.get(state.bookingId);
    if (!booking || row.staffId !== booking.staffId) return;
    void state.loading.then((zones) => {
      const start = snapDrop(zones, row.id, wanted);
      if (start === null) latest.current.onDropRejected(PICK_HIGHLIGHTED);
      else if (start !== booking.start) latest.current.onProposeMove(booking.id, start);
    });
  };

  const config = useMemo<Partial<SchedulerConfig>>(() => {
    const p = props;
    const now = Date.now();
    const rows = rowsOf(p, now);
    rowRef.current = new Map(rows.map((r) => [r.id, r]));
    const ids = new Set(rows.map((r) => r.id));
    const [startDate, endDate] = axisSpan(axisOf(p));
    applied.current = layoutKey(p, rows);
    const events = buildEvents(p, ids, now);
    return {
      startDate,
      endDate,
      rowHeight: ROW_HEIGHT[mode],
      barMargin: 6,
      resourceMargin: 6,
      eventLayout: "stack",
      eventStyle: "filled",
      snap: true,
      useInitialAnimation: "fade-in",
      zoomOnMouseWheel: false,
      zoomOnTimeAxisDoubleClick: false,
      createEventOnDblClick: false,
      fillTicks: false,
      viewPreset: {
        base: "hourAndDay",
        tickWidth: HALF_HOUR_MIN_WIDTH,
        displayDateFormat: "HH:mm",
        timeResolution: { unit: "minute", increment: 15 },
        columnLinesFor: 1,
        headers: [
          { unit: "hour", dateFormat: "HH:mm" },
          { unit: "minute", increment: 30, renderer: (start: Date) => (start.getMinutes() === 0 ? "" : ":30") },
        ],
      },
      columns: columnsOf(mode, p.currency),
      resources: buildResources(p, rows),
      events,
      dependencies: buildDependencies(events),
      resourceTimeRanges: [...buildRanges(p, rows, now), ...tickRanges(p, ids, p.ticks)],
      eventRenderer: ({ eventRecord, renderData }) => {
        const kind = eventRecord.get("kind") as Kind;
        const wrapperCls = renderData.wrapperCls as DomClassList;
        wrapperCls.add("kt-ev", `kt-ev-${String(eventRecord.get("look"))}`);
        if (eventRecord.get("flash")) wrapperCls.add("kt-flash");
        if (eventRecord.get("fading")) wrapperCls.add("kt-fading");
        const tz = latest.current.timeZone;
        const b = byIdRef.current.get(String(eventRecord.get("bookingId")));
        if (!b) return "";
        const length = b.end - b.start;
        if (kind === "offer") {
          const at = Number(eventRecord.get("offerStart"));
          return eventHtml(b.clientName ?? "Client", b.serviceName, at, at + length, "Offered · her pick", tz);
        }
        if (kind === "ghost") {
          const proposed = latest.current.proposals[b.id] ?? b.start;
          return eventHtml(b.clientName ?? "Client", b.serviceName, proposed, proposed + length, "Proposed · awaiting reply", tz);
        }
        return eventHtml(b.clientName ?? "Slot on hold", b.serviceName, b.start, b.end, statusChip(b), tz, eventRecord.get("agent") === true);
      },
      onEventClick: ({ eventRecord, event }) => {
        const bookingId = eventRecord.get("bookingId") as string | null;
        const element = event.target instanceof Element ? event.target.closest(".b-sch-event-wrap") : null;
        if (bookingId && element) latest.current.onSelect(bookingId, element.getBoundingClientRect());
      },
      onCellClick: ({ record, column }) => {
        if (column.field !== "dayLabel" || latest.current.zoom !== "week") return;
        const row = rowRef.current.get(String(record.id));
        if (row) latest.current.onOpenDay(row.day);
      },
      onEventDragStart: ({ eventRecords }) => {
        const booking = byIdRef.current.get(String(eventRecords[0]?.get("bookingId")));
        if (booking) startDrag(booking);
      },
      onBeforeEventDropFinalize: ({ context }) => {
        // The calendar never moves a booking itself: the drop is invalid (it snaps back), a ghost shows the proposal
        // and the agent asks the client.
        context.valid = false;
        const row = rowRef.current.get(String(context.newResource.id));
        if (row) settleDrop(row, fromAxis(context.startDate, row.day, latest.current.timeZone));
      },
      onAfterEventDrop: () => {
        // An invalid drop (red) skips the finalize step: the last position the validator saw decides.
        const last = dragRef.current?.last;
        const row = last ? rowRef.current.get(last.rowId) : undefined;
        if (row && last) settleDrop(row, last.wanted);
        endDrag();
      },
      onEventDragAbort: () => {
        if (dragRef.current) dragRef.current.done = true;
        endDrag();
      },
      onBeforeDragCreateFinalize: ({ context, resourceRecord }) => {
        const tz = latest.current.timeZone;
        // Nothing is created in the calendar: the range opens the block dialog.
        context.async = true;
        setTimeout(() => context.finalize(false), 0);
        const row = rowRef.current.get(String(resourceRecord.id));
        if (!row) return;
        latest.current.onBlockRange({ staffId: row.staffId, from: fromAxis(context.startDate, row.day, tz), to: fromAxis(context.endDate, row.day, tz) });
      },
    };
    // Rebuilt per view only: data flows through the stores.
  }, [mode]);

  const features = useMemo(
    () => ({
      eventDrag: {
        constrainDragToResource: false,
        showTooltip: true,
        validatorFn: ({ eventRecords, newResource, startDate }: { eventRecords: EventModel[]; newResource: ResourceModel; startDate: Date }) => {
          const scheduler = ref.current?.instance as Scheduler | undefined;
          const booking = byIdRef.current.get(String(eventRecords[0]?.get("bookingId")));
          const row = rowRef.current.get(String(newResource.id));
          const state = dragRef.current;
          const mark = (ok: boolean) => {
            scheduler?.element.classList.toggle("kt-drop-ok", ok);
            scheduler?.element.classList.toggle("kt-drop-bad", !ok);
          };
          if (!booking || !row) return true;
          if (row.staffId !== booking.staffId) {
            if (state) state.last = null;
            mark(false);
            return { valid: false, message: `Stays with ${booking.staffName}` };
          }
          const wanted = fromAxis(startDate, row.day, latest.current.timeZone);
          if (!state?.zones) {
            if (state) state.last = { rowId: row.id, wanted, snapped: null };
            return { valid: true, message: `Checking ${booking.staffName}'s free times…` };
          }
          const snapped = snapDrop(state.zones, row.id, wanted);
          state.last = { rowId: row.id, wanted, snapped };
          mark(snapped !== null);
          const offer = offerLabel(booking.staffName, state.zones, row.id, latest.current.timeZone);
          return snapped === null ? { valid: false, message: `${PICK_HIGHLIGHTED} · ${offer}` } : { valid: true, message: offer };
        },
        tooltipTemplate: ({ startDate, endDate, newResource, valid, message }: { startDate: Date; endDate: Date; newResource: ResourceModel; valid: boolean; message?: string }) => {
          const tz = latest.current.timeZone;
          const row = rowRef.current.get(String(newResource.id));
          if (!row) return "";
          const snapped = valid ? dragRef.current?.last?.snapped : null;
          const length = endDate.getTime() - startDate.getTime();
          const label = snapped != null ? dropLabel(snapped, snapped + length, tz) : dropLabel(fromAxis(startDate, row.day, tz), fromAxis(endDate, row.day, tz), tz);
          const hint = valid ? (snapped != null ? "Drop to ask the client" : "") : message?.startsWith("Stays with") ? "Moves keep the same stylist" : PICK_HIGHLIGHTED;
          const offer = message && !message.startsWith(PICK_HIGHLIGHTED) && !message.startsWith("Stays with") ? message : message?.split(" · ").slice(1).join(" · ");
          return dragTip(label, valid, hint, offer);
        },
      },
      eventResize: false,
      eventEdit: false,
      simpleEventEdit: false,
      eventCopyPaste: false,
      eventDragCreate: {
        showTooltip: true,
        tooltipTemplate: ({ startDate, endDate }: { startDate: Date; endDate: Date }) =>
          `<div class="kt-tip"><strong>Block ${wall(startDate)}–${wall(endDate)}</strong><br>Release to choose a reason</div>`,
      },
      mergeCells: { sortedOnly: false, passthrough: true },
      cellMenu: false,
      scheduleTooltip: false,
      headerMenu: false,
      timeAxisHeaderMenu: false,
      timeRanges: false,
      resourceTimeRanges: true,
      // The receptionist's offered times (and the pro's proposals) hang off the booking they would replace. Read-only:
      // the lines are drawn from the data, nobody creates or deletes one by hand.
      dependencies: {
        allowCreate: false,
        enableDelete: false,
        showTooltip: false,
        clickWidth: null,
        radius: 8,
        highlightDependenciesOnEventHover: true,
      },
      // Week totals of the money columns under the locked grid (the time axis part stays empty).
      summary: mode === "day" ? false : { renderer: () => "" },
      eventTooltip: {
        hoverDelay: 350,
        template: ({ eventRecord }: { eventRecord: EventModel }) => {
          const b = byIdRef.current.get(String(eventRecord.get("bookingId")));
          if (!b) return "";
          const tz = latest.current.timeZone;
          if (eventRecord.get("kind") === "ghost") {
            const proposed = latest.current.proposals[b.id] ?? b.start;
            return `<div class="kt-tip"><strong>Proposed move</strong> · ${encode(b.clientName ?? "Client")}<br>${encode(dropLabel(proposed, proposed + (b.end - b.start), tz))}<br>Waiting for her reply · the booking stays at ${formatClock(b.start, tz)} until then</div>`;
          }
          if (eventRecord.get("kind") === "offer") {
            const at = Number(eventRecord.get("offerStart"));
            const offered = latest.current.offers[b.id]?.starts.length ?? 0;
            return `<div class="kt-tip"><strong>Offered by your front desk</strong> · ${encode(b.clientName ?? "Client")}<br>${encode(dropLabel(at, at + (b.end - b.start), tz))}<br>One of ${offered} time${offered === 1 ? "" : "s"} she can pick, or a full refund<br><span class="kt-tip-hint">Instead of ${encode(dropLabel(b.start, b.end, tz))}</span></div>`;
          }
          return `<div class="kt-tip"><strong>${encode(b.clientName ?? "Slot on hold")}</strong> · ${encode(b.serviceName)}<br>${encode(dropLabel(b.start, b.end, tz))} · ${encode(b.staffName)}<br>${encode(lookLabel(b))} · deposit ${formatMoney(b.depositCents, b.currency)} of ${formatMoney(b.priceCents, b.currency)}${agentLine(latest.current.agentChanges[b.id], tz)}<br><span class="kt-tip-hint">Click for details</span></div>`;
        },
      },
      scheduleMenu: {
        items: {
          addEvent: false,
          blockTime: {
            text: "Block time here",
            icon: "fa fa-ban",
            onItem: ({ date, resourceRecord }: { date: Date; resourceRecord: ResourceModel }) => {
              const row = rowRef.current.get(String(resourceRecord.id));
              if (!row) return;
              const from = fromAxis(date, row.day, latest.current.timeZone);
              latest.current.onBlockRange({ staffId: row.staffId, from, to: from + 60 * 60 * 1000 });
            },
          },
        },
      },
      eventMenu: {
        items: {
          editEvent: false,
          deleteEvent: false,
          unassignEvent: false,
          copyEvent: false,
          cutEvent: false,
          splitEvent: false,
          markDone: { text: "Mark done", icon: "fa fa-check", onItem: ({ eventRecord }: { eventRecord: EventModel }) => latest.current.onAction(String(eventRecord.get("bookingId")), "honoured") },
          noShow: { text: "No-show", icon: "fa fa-user-slash", onItem: ({ eventRecord }: { eventRecord: EventModel }) => latest.current.onAction(String(eventRecord.get("bookingId")), "no_show") },
          cancel: { text: "Cancel (full refund)", icon: "fa fa-rotate-left", cls: "b-separator", onItem: ({ eventRecord }: { eventRecord: EventModel }) => latest.current.onAction(String(eventRecord.get("bookingId")), "cancel") },
        },
        processItems: ({ eventRecord }: { eventRecord: EventModel }) => {
          const look = eventRecord.get("look") as string;
          return eventRecord.get("kind") === "booking" && (look === "confirmed" || look === "unpaid" || look === "displaced");
        },
      },
    }),
    // Rebuilt with the scheduler (its key is the mode): the money summary only exists in the week.
    [mode],
  );

  // Layout and stores. A new set of rows or a new axis (zoom, day, week, staff) replaces everything at once; a
  // Realtime refetch only updates records in place, so Bryntum animates what moved.
  useEffect(() => {
    const scheduler = ref.current?.instance as Scheduler | undefined;
    if (!scheduler) return;
    const now = Date.now();
    const rows = rowsOf(props, now);
    rowRef.current = new Map(rows.map((r) => [r.id, r]));
    const ids = new Set(rows.map((r) => r.id));
    const key = layoutKey(props, rows);
    const resources = buildResources(props, rows);
    const events = buildEvents(props, ids, now);
    const dependencies = buildDependencies(events);
    const ranges = [...buildRanges(props, rows, now), ...tickRanges(props, ids, props.ticks)];
    const rangeStore = scheduler.resourceTimeRangeStore as Store;
    const dependencyStore = scheduler.dependencyStore as unknown as Store;

    if (applied.current !== key) {
      const [start, end] = axisSpan(axisOf(props));
      applied.current = key;
      fadingRef.current.clear();
      dependencyStore.removeAll(true);
      scheduler.eventStore.removeAll(true);
      rangeStore.removeAll(true);
      scheduler.resourceStore.data = resources;
      void scheduler.setTimeSpan(start, end);
      scheduler.eventStore.data = events;
      dependencyStore.data = dependencies;
      rangeStore.data = ranges;
      const today = rows.find((r) => r.today);
      if (today && modeOf(props) === "studioWeek") void scheduler.scrollResourceIntoView(scheduler.resourceStore.getById(today.id) as ResourceModel, { block: "start" });
      else if (scheduler.resourceStore.first) void scheduler.scrollRowIntoView(scheduler.resourceStore.first, { block: "start" });
      return;
    }

    for (const r of resources) {
      const existing = scheduler.resourceStore.getById(r.id) as ResourceModel | undefined;
      existing?.set({ summary: r.summary, open: r.open, cls: r.cls, today: r.today, captured: r.captured, refunded: r.refunded, paidOut: r.paidOut });
    }

    // The client answered: her booking slides to the time she picked (that offer goes at once, the booking takes its
    // place), the other offers and their lines fade out, then leave the stores.
    const nextIds = new Set(events.map((e) => e.id));
    const landed = new Set(events.filter((e) => e.kind === "booking").map((e) => `${e.bookingId}|${String(e.resourceId)}|${(e.startDate as Date).getTime()}`));
    for (const record of scheduler.eventStore.records) {
      const id = String(record.id);
      if (nextIds.has(id) || fadingRef.current.has(id) || record.get("kind") === "booking") continue;
      const key = `${String(record.get("bookingId"))}|${String(record.get("resourceId"))}|${(record.get("startDate") as Date).getTime()}`;
      if (landed.has(key)) continue;
      fadingRef.current.add(id);
      record.set({ fading: true });
      const dependency = dependencyStore.getById(`dep:${id}`);
      dependency?.set({ cls: "kt-dep kt-dep-fading" });
      setTimeout(() => {
        fadingRef.current.delete(id);
        const scheduler = ref.current?.instance as Scheduler | undefined;
        if (!scheduler) return;
        const depStore = scheduler.dependencyStore as unknown as Store;
        const dep = depStore.getById(`dep:${id}`);
        if (dep && !nextDependencyIds.current.has(`dep:${id}`)) depStore.remove(dep);
        const event = scheduler.eventStore.getById(id);
        if (event && !nextEventIds.current.has(id)) scheduler.eventStore.remove(event);
      }, FADE_MS);
    }
    nextEventIds.current = nextIds;
    nextDependencyIds.current = new Set(dependencies.map((d) => d.id));
    const stay = (id: string) => fadingRef.current.has(id) || fadingRef.current.has(id.replace(/^dep:/, ""));
    // Lines first out, events first in: a line never points at a missing booking.
    const deps = dependencyStore.records.filter((r) => !nextDependencyIds.current.has(String(r.id)) && !stay(String(r.id)));
    if (deps.length) dependencyStore.remove(deps);
    syncStore(scheduler.eventStore, events, (e) => withoutId(e as EventData), stay);
    syncStore(dependencyStore, dependencies, (d) => withoutId(d as DependencyData), stay);
    // The drop zones of a drag in progress are not part of the props: keep them.
    const zones = rangeStore.records.filter((r) => String(r.id).startsWith("target:")).map((r) => ({ id: String(r.id) }));
    syncStore(rangeStore, [...ranges, ...zones], (r) => (String(r.id).startsWith("target:") ? {} : withoutId(r as RangeData)));
  }, [props, minute]);

  // The hold countdowns tick every second without re-rendering React; the minute moves the "now" line.
  useEffect(() => {
    const tick = setInterval(() => {
      const scheduler = ref.current?.instance as Scheduler | undefined;
      if (!scheduler) return;
      const now = Date.now();
      for (const el of scheduler.element.querySelectorAll<HTMLElement>(".kt-countdown[data-until]")) {
        el.textContent = formatCountdown(Number(el.dataset.until), now);
      }
      setMinute((m) => (Math.floor(now / 60_000) === m ? m : Math.floor(now / 60_000)));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // ---- the cascade grid: displaced bookings waiting for their client, dragged onto the Scheduler -------------------

  const cascade = useMemo(() => cascadeRows(props.bookings, props.offers, props.proposals), [props.bookings, props.offers, props.proposals]);
  // Once a week had displaced bookings, the panel stays while the last rows animate out ("every client has answered").
  const [cascadeWeek, setCascadeWeek] = useState<number | null>(null);
  if (cascade.length > 0 && cascadeWeek !== props.weekStart) setCascadeWeek(props.weekStart);
  const showCascade = cascade.length > 0 || cascadeWeek === props.weekStart;

  // Bryntum's drag-from-grid pattern: a DragHelper on the grid's rows, a proxy shaped like the booking, the start read
  // from the proxy's position on the time axis. Same drop zones, snapping and validation as a drag in the calendar;
  // a drop asks the client (proposeMove), it never moves the booking itself.
  useEffect(() => {
    const scheduler = ref.current?.instance as Scheduler | undefined;
    const grid = gridRef.current?.instance as Grid | undefined;
    if (!showCascade || !scheduler || !grid) return;
    let tip: Tooltip | null = null;
    let active: { booking: CalBooking; row: Row | null; wanted: number | null; valid: boolean; message: string } | null = null;
    const mark = (ok: boolean | null) => {
      scheduler.element.classList.toggle("kt-drop-ok", ok === true);
      scheduler.element.classList.toggle("kt-drop-bad", ok === false);
    };
    const finish = () => {
      tip?.hide();
      scheduler.disableScrollingCloseToEdges(scheduler.timeAxisSubGrid);
      scheduler.features.eventTooltip.disabled = false;
      endDrag();
    };
    const helper = new DragHelper({
      cloneTarget: true,
      autoSizeClonedTarget: false,
      mode: "translateXY",
      outerElement: grid.element,
      targetSelector: ".b-grid-row",
      dropTargetSelector: ".b-timeline-sub-grid",
      scrollManager: (scheduler as unknown as { scrollManager: DragHelperScroll }).scrollManager,
      createProxy: (element: HTMLElement) => {
        const booking = byIdRef.current.get(String(grid.getRecordFromElement(element)?.id));
        const proxy = document.createElement("div");
        proxy.className = "kt-grid-proxy";
        const length = booking ? booking.end - booking.start : 60 * 60_000;
        proxy.style.width = `${Math.max(48, scheduler.timeAxisViewModel.getDistanceForDuration(length))}px`;
        proxy.style.height = `${scheduler.rowHeight - 12}px`;
        proxy.innerHTML = booking
          ? `<div class="kt-grid-proxy-bar">${eventHtml(booking.clientName ?? "Client", booking.serviceName, booking.start, booking.end, "Drop on a highlighted time", latest.current.timeZone)}</div>`
          : "";
        return proxy;
      },
      listeners: {
        dragStart: ({ context }: { context: { grabbed: HTMLElement } }) => {
          const booking = byIdRef.current.get(String(grid.getRecordFromElement(context.grabbed)?.id));
          if (!booking) return;
          active = { booking, row: null, wanted: null, valid: false, message: "" };
          startDrag(booking);
          scheduler.features.eventTooltip.disabled = true;
          scheduler.enableScrollingCloseToEdges(scheduler.timeAxisSubGrid);
        },
        drag: ({ context, event }: { context: { element: HTMLElement; target: HTMLElement | null; valid: boolean }; event: MouseEvent }) => {
          if (!active) return;
          const tz = latest.current.timeZone;
          const { booking } = active;
          const target = context.target instanceof HTMLElement && context.target.closest(".b-timeline-sub-grid") ? context.target : null;
          const date = target ? scheduler.getDateFromCoordinate(DomHelper.getTranslateX(context.element), "round", false, true) : null;
          const resource = target && date ? scheduler.resolveResourceRecord(target, [event.offsetX, event.offsetY]) : null;
          const row = resource ? rowRef.current.get(String(resource.id)) : undefined;
          const state = dragRef.current;
          const proxyMark = (ok: boolean | null) => {
            context.element.classList.toggle("kt-proxy-ok", ok === true);
            context.element.classList.toggle("kt-proxy-bad", ok === false);
          };
          if (!row || !date || !state) {
            active.row = null;
            context.valid = false;
            mark(null);
            proxyMark(null);
            tip?.hide();
            return;
          }
          const wanted = fromAxis(date, row.day, tz);
          active.row = row;
          active.wanted = wanted;
          let label = dropLabel(wanted, wanted + (booking.end - booking.start), tz);
          let hint = "";
          let offer: string | undefined;
          if (row.staffId !== booking.staffId) {
            active.valid = false;
            active.message = `Moves keep the same stylist: ${booking.staffName}`;
            hint = "Moves keep the same stylist";
          } else if (!state.zones) {
            active.valid = true;
            hint = `Checking ${booking.staffName}'s free times…`;
          } else {
            const snapped = snapDrop(state.zones, row.id, wanted);
            state.last = { rowId: row.id, wanted, snapped };
            active.valid = snapped !== null;
            active.message = PICK_HIGHLIGHTED;
            offer = offerLabel(booking.staffName, state.zones, row.id, tz);
            if (snapped !== null) {
              label = dropLabel(snapped, snapped + (booking.end - booking.start), tz);
              hint = "Drop to ask the client";
            } else hint = PICK_HIGHLIGHTED;
          }
          context.valid = active.valid;
          mark(active.valid);
          proxyMark(active.valid);
          tip ??= new Tooltip({ align: "b-t", forElement: context.element, cls: "b-sch-event-tooltip" });
          tip.html = dragTip(label, active.valid, hint, offer);
          void tip.showBy(context.element);
        },
        drop: () => {
          const done = active;
          active = null;
          if (done?.row && done.wanted !== null) {
            if (done.valid) settleDrop(done.row, done.wanted);
            else latest.current.onDropRejected(done.message || PICK_HIGHLIGHTED);
          }
          if (dragRef.current) dragRef.current.done = true;
          finish();
        },
        abort: () => {
          active = null;
          if (dragRef.current) dragRef.current.done = true;
          finish();
        },
      },
    });
    return () => {
      helper.destroy();
      tip?.destroy();
    };
    // The helper binds this scheduler and grid instance: rebuilt with them.
  }, [mode, showCascade]);

  const cascadeHeight = 36 + 36 + 40 * Math.max(1, Math.min(cascade.length, 3)) + 2;

  // While the cascade panel takes the bottom of the card, the week's rows get shorter so the whole week still shows.
  useEffect(() => {
    const scheduler = ref.current?.instance as Scheduler | undefined;
    if (!scheduler || mode === "day") return;
    scheduler.rowHeight = showCascade ? CASCADE_ROW_HEIGHT[mode] : ROW_HEIGHT[mode];
  }, [mode, showCascade]);

  return (
    <div className={`kt-cal-mode-${mode} flex h-full flex-col`} aria-label={props.zoom === "day" ? `Day: ${formatDay(props.focusDay, props.timeZone)}` : "Week"}>
      <div className="min-h-0 flex-1">
        <BryntumScheduler key={mode} {...config} {...featureProps(features)} ref={ref as unknown as Ref<BryntumScheduler>} />
      </div>
      {showCascade && (
        <section className="kt-cascade flex shrink-0 flex-col border-t border-hairline" style={{ height: cascadeHeight }} aria-label="Waiting for client">
          <header className="flex h-9 min-w-0 shrink-0 items-center gap-2 px-4">
            <span className={`size-2 shrink-0 rounded-full ${cascade.length ? "bg-danger" : "bg-success"}`} aria-hidden />
            <strong className="text-caption whitespace-nowrap">{cascade.length ? `Waiting for client · ${cascade.length}` : "Every client has answered"}</strong>
            <span className="truncate text-[12px] text-muted">
              {cascade.length
                ? "Your front desk offered each client new times (dashed). Drag a row onto a highlighted time to propose one yourself."
                : "Moved bookings show ✦ in the calendar."}
            </span>
          </header>
          <div className="min-h-0 flex-1">
            <CascadeGrid rows={cascade} timeZone={props.timeZone} gridRef={gridRef} onOpen={(id, anchor) => latest.current.onSelect(id, anchor)} />
          </div>
        </section>
      )}
    </div>
  );
}

/** What the DragHelper needs from the scheduler's scroll manager (scrolling while dragging near its edges). */
type DragHelperScroll = ConstructorParameters<typeof DragHelper>[0] extends infer C ? (C extends { scrollManager?: infer S } ? S : never) : never;

/** Which rows on which axis: the stores are replaced when this changes. */
function layoutKey(p: CalendarProps, rows: Row[]): string {
  const a = axisOf(p);
  return `${modeOf(p)}|${a.year}-${a.month}-${a.day}|${rows.map((r) => r.id).join(",")}`;
}

/** The React wrapper takes features as `<name>Feature` props. */
function featureProps(features: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(features).map(([name, value]) => [`${name}Feature`, value]));
}
