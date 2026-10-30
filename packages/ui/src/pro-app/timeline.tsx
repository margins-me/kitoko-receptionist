import { cn } from "../cn";
import { formatTime } from "../format";
import { clockTime, entryPosition, entrySize, hourMarks, isOneLine, overlapColumns, place } from "./geometry";
import type { HourRange } from "./geometry";

// Blocks of a day column (P06, T01): bookings sized to their duration, holds and manual bookings waiting for
// their deposit drawn apart, blocks in grey, free gaps dashed. Every state also has a word, never colour alone.
// Items drawn over each other (a no-show and the booking that took its place) share the width side by side.

const LOOK = {
  booking: "bg-inverse text-on-inverse",
  honoured: "bg-inverse text-on-inverse",
  pending: "border-[1.5px] border-honey bg-warning text-ink",
  noShow: "border border-hairline bg-soft text-muted",
  block: "bg-hairline text-body",
  gap: "border-[1.5px] border-dashed border-grip bg-surface text-body",
} as const;

export type TimelineLook = keyof typeof LOOK;

/** One block of a timeline, display-ready. */
export type TimelineEntry = {
  key: string;
  /** Minutes since local midnight. */
  start: number;
  /** Minutes. */
  length: number;
  look: TimelineLook;
  /** "9 h – 11 h" */
  time: string;
  title: string;
  sub: string;
  /** The status word after the time ("À confirmer"), none for a plain booking. */
  tag: string | null;
  /** The button's accessible name. */
  label: string;
  /** A no-show's name is struck through. */
  struck?: boolean;
  /** Shown in the desktop panel. */
  selected?: boolean;
  onSelect?: () => void;
};

export function TimelineView({
  entries,
  range,
  pxPerMinute,
  minHeight,
  compact,
  className,
}: {
  entries: TimelineEntry[];
  range: HourRange;
  pxPerMinute: number;
  minHeight: number;
  /** Desktop columns: smaller type. */
  compact?: boolean;
  className?: string;
}) {
  const boxes = entries.map((entry) => place(entry, range, pxPerMinute, minHeight));
  // Columns from the true durations: an item only stretched to its minimum height keeps the full width.
  const columns = overlapColumns(entries.map((entry) => place(entry, range, pxPerMinute, 0)));
  return (
    <ol className={cn("relative", className)} style={{ height: (range.to - range.from) * pxPerMinute }}>
      {entries.map((entry, n) => (
        <Entry key={entry.key} entry={entry} box={boxes[n]!} slot={columns[n]!} compact={compact} />
      ))}
    </ol>
  );
}

/** One block of the timeline: a button over its place, sized to the item. */
function Entry({
  entry,
  box,
  slot,
  compact,
}: {
  entry: TimelineEntry;
  box: { top: number; height: number };
  slot: { column: number; columns: number };
  compact: boolean | undefined;
}) {
  const size = entrySize(compact);
  return (
    <li className={cn("absolute", slot.column < slot.columns - 1 && "pr-1")} style={entryPosition(box, slot)}>
      <button
        type="button"
        onClick={entry.onSelect}
        aria-pressed={compact ? Boolean(entry.selected) : undefined}
        aria-label={entry.label}
        className={cn("flex size-full flex-col items-start overflow-hidden text-left", size.button, LOOK[entry.look], entry.selected && "ring-3 ring-honey")}
      >
        <EntryContent entry={entry} size={size} oneLine={isOneLine(box.height, compact)} />
      </button>
    </li>
  );
}

/** The block's words: title then time on one line when it is short, else time, title and details. */
function EntryContent({ entry, size, oneLine }: { entry: TimelineEntry; size: ReturnType<typeof entrySize>; oneLine: boolean }) {
  const { time, title, sub, tag, struck } = entry;
  const timeTag = (
    <>
      {time}
      {tag && <span className="font-semibold">{` · ${tag}`}</span>}
    </>
  );
  if (oneLine) {
    return (
      <span className="flex w-full min-w-0 items-baseline gap-1.5">
        <strong className={cn("shrink-0 font-semibold", size.title, struck && "line-through")}>{title}</strong>
        <span className={cn("min-w-0 truncate opacity-90", size.time)}>{timeTag}</span>
      </span>
    );
  }
  return (
    <>
      <span className={cn(size.time, "opacity-90")}>{timeTag}</span>
      <strong className={cn("font-semibold", size.title, struck && "line-through")}>{title}</strong>
      <span className={cn(size.sub)}>{sub}</span>
    </>
  );
}

/** Hour labels and lines behind a timeline. */
export function HourLines({ range, pxPerMinute, locale, labels = true }: { range: HourRange; pxPerMinute: number; locale: string; labels?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {hourMarks(range).map((m) => (
        <div key={m} className="absolute inset-x-0 flex items-start gap-2" style={{ top: (m - range.from) * pxPerMinute }}>
          {labels && <span className="w-9 shrink-0 -translate-y-2 text-right text-xs text-muted tabular-nums">{formatTime(clockTime(m), locale)}</span>}
          <span className="h-px flex-1 bg-hairline" />
        </div>
      ))}
    </div>
  );
}
