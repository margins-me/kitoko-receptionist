"use client";

// Adapted from React Bits "Rubber Segment" (reactbits.dev/c/micro/rubber-segment, MIT).
// ponytail: CSS transitions on the four edges instead of motion springs, and no drag. The leading edge runs ahead and the
// trailing one catches up with a small overshoot, which gives the stretch and the squash.
import { useLayoutEffect, useRef } from "react";
import { cn } from "../cn";
import { edgeTransition, insetBox } from "./segment-geometry";
import type { Box } from "./segment-geometry";

/** Last position per `memory` key, so an indicator that remounts on navigation slides from where the old one was. */
const remembered = new Map<string, Box>();

/**
 * Sliding shape behind the active item of a row. Render it as a child of the row, which must be `relative isolate`;
 * it sits at z-index -1, so items over it need no background. Once placed it sets `data-seg` on the row: style the
 * active item's own fill away with e.g. `[[data-seg]>&]:bg-transparent`, so it still shows without JavaScript.
 */
export function SegmentIndicator({
  selector,
  active,
  memory,
  className,
}: {
  /** Finds the active item inside the row, e.g. `[aria-pressed=true]` or `[aria-current=page]`. */
  selector: string;
  /** Changes when the active item changes (its value, a pathname…): the indicator measures again. */
  active: unknown;
  /** Key under which the last position is kept across remounts (route changes). */
  memory?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const box = useRef<Box | null>(null);

  const place = (animate: boolean) => {
    const el = ref.current;
    const row = el?.parentElement;
    const target = row?.querySelector<HTMLElement>(selector);
    if (!el || !row || !target) {
      if (el) el.style.opacity = "0";
      return;
    }
    const next = insetBox(row.getBoundingClientRect(), target.getBoundingClientRect(), row);
    el.style.transition = edgeTransition(box.current, next, animate);
    el.style.left = `${next.left}px`;
    el.style.top = `${next.top}px`;
    el.style.right = `${next.right}px`;
    el.style.bottom = `${next.bottom}px`;
    el.style.opacity = "1";
    box.current = next;
    if (memory) remembered.set(memory, next);
  };

  // Mount: start from the remembered spot (if any), keep in place on resize, and tell the row the indicator is drawn.
  useLayoutEffect(() => {
    const el = ref.current;
    const row = el?.parentElement;
    if (!el || !row) return undefined;
    const from = memory ? remembered.get(memory) : undefined;
    if (from) {
      Object.assign(el.style, { transition: "none", left: `${from.left}px`, top: `${from.top}px`, right: `${from.right}px`, bottom: `${from.bottom}px` });
      el.getBoundingClientRect(); // commit the old spot so the next placement transitions from it
      box.current = from;
    }
    row.dataset.seg = "";
    let first = true; // the observer reports once on start: that one is not a resize
    const observer = new ResizeObserver(() => {
      if (!first) place(false);
      first = false;
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      delete row.dataset.seg;
    };
  }, []);

  useLayoutEffect(() => {
    place(true);
  }, [active, selector]);

  return <span ref={ref} aria-hidden className={cn("pointer-events-none absolute -z-10 opacity-0", className)} />;
}
