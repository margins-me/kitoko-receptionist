// Pure geometry behind <SegmentIndicator>: where the indicator sits inside its row and how its edges move there.
// Kept apart so tests run it without a DOM.

export type Box = { left: number; top: number; right: number; bottom: number };
type Rect = { left: number; top: number; right: number; bottom: number };
type Row = { clientLeft: number; clientTop: number; clientWidth: number; clientHeight: number };

const LEAD = "180ms cubic-bezier(0.23,1,0.32,1)";
const TRAIL = "320ms cubic-bezier(0.3,1.25,0.6,1) 40ms";
const ROWS = "top 240ms ease, bottom 240ms ease";

/** Insets of the target inside the row's padding box (`p` is the row's rect, `r` the target's). */
export function insetBox(p: Rect, r: Rect, row: Row): Box {
  const left = p.left + row.clientLeft;
  const top = p.top + row.clientTop;
  return {
    left: r.left - left,
    top: r.top - top,
    right: left + row.clientWidth - r.right,
    bottom: top + row.clientHeight - r.bottom,
  };
}

/** The leading edge runs ahead and the trailing one catches up; no transition when not animating or not moving sideways. */
export function edgeTransition(prev: Box | null, next: Box, animate: boolean): string {
  const shift = prev ? next.left - next.right - (prev.left - prev.right) : 0;
  if (!animate || shift === 0) return "none";
  const [l, rr] = shift > 0 ? [TRAIL, LEAD] : [LEAD, TRAIL];
  return `left ${l}, right ${rr}, ${ROWS}`;
}
