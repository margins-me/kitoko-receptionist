// Vertical geometry of the pro app's timelines (P06 day, T01 week), and how one block of a timeline is placed and
// sized. Pure, in minutes since local midnight: the dashboard converts its instants, the landing writes minutes.

export type HourRange = { from: number; to: number };

/** "HH:MM" of minutes since midnight (540 → "09:00"). */
export const clockTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const hourMarks = (range: HourRange): number[] =>
  Array.from({ length: (range.to - range.from) / 60 + 1 }, (_, n) => range.from + n * 60);

/** Top and height in px of an item (start in minutes since midnight, length in minutes), clipped to the range; at least `minHeight` so its text stays readable. */
export function place(
  item: { start: number; length: number },
  range: HourRange,
  pxPerMinute: number,
  minHeight: number,
): { top: number; height: number } {
  const start = Math.max(item.start, range.from);
  const end = Math.min(item.start + item.length, range.to);
  const top = Math.round((start - range.from) * pxPerMinute);
  return { top, height: Math.max(minHeight, Math.round((end - start) * pxPerMinute) - 3) };
}

// Side-by-side columns for timeline items drawn over each other (a no-show and the booking that took its
// place, a free gap over a no-show).

type Box = { top: number; height: number };
type Columns = { column: number; columns: number };

/**
 * For each box (same order as given), its column and the column count of its group of overlapping boxes.
 * Boxes that touch (one's bottom is the next one's top) do not overlap. Earlier boxes, and at the same top the
 * earlier given, take the left columns.
 */
export function overlapColumns(boxes: Box[]): Columns[] {
  const out: Columns[] = boxes.map(() => ({ column: 0, columns: 1 }));
  const order = boxes.map((_, n) => n).toSorted((a, b) => boxes[a]!.top - boxes[b]!.top || a - b);
  let group: number[] = [];
  let bottoms: number[] = [];
  let groupBottom = -Infinity;
  const close = () => {
    for (const n of group) out[n]!.columns = bottoms.length;
    group = [];
    bottoms = [];
  };
  for (const n of order) {
    const { top, height } = boxes[n]!;
    const bottom = top + height;
    if (top >= groupBottom) close();
    let column = bottoms.findIndex((b) => b <= top);
    if (column === -1) column = bottoms.push(bottom) - 1;
    else bottoms[column] = bottom;
    out[n]!.column = column;
    group.push(n);
    groupBottom = group.length === 1 ? bottom : Math.max(groupBottom, bottom);
  }
  close();
  return out;
}

/** Box heights (px) below which the time line and the title no longer both fit: padding plus two lines. */
const ONE_LINE_BELOW = 66;
const ONE_LINE_BELOW_COMPACT = 52;

/** Too short for the time line above the title (a 45-minute gap): one line, title first, so it never hides. */
export const isOneLine = (height: number, compact: boolean | undefined): boolean => height < (compact ? ONE_LINE_BELOW_COMPACT : ONE_LINE_BELOW);

/** The box's place: its top and height, and its share of the width among the items drawn over each other. */
export function entryPosition(box: Box, slot: Columns) {
  const { column, columns: count } = slot;
  return { top: box.top, height: box.height, left: `${(column / count) * 100}%`, right: `${((count - column - 1) / count) * 100}%` };
}

/** Type sizes and padding: desktop columns (compact) use smaller ones. */
export const entrySize = (compact: boolean | undefined) =>
  compact
    ? { button: "gap-px rounded-[10px] p-2", title: "text-sm leading-tight", time: "text-xs", sub: "text-xs leading-snug" }
    : { button: "gap-0.5 rounded-input px-3 py-2.5", title: "", time: "text-caption", sub: "text-caption" };
