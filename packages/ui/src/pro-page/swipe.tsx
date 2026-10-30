"use client";

import { useState } from "react";
import type { ReactNode, UIEvent } from "react";

export type SwipeProps = {
  /** How many slides the list holds (the "1/4" chip). */
  count: number;
  /** Accessible name of the list, e.g. "Photos de Nala". */
  label: string;
  /** The slides: server-rendered <li>s. */
  children: ReactNode;
  className: string;
  listClassName: string;
};

/**
 * Encadré's inset photos: CSS scroll-snap does the swiping; this only follows the scroll for the "1/4" chip in the
 * corner. The chip is a visual: the list already tells assistive tech each photo's place ("2 of 4"). Fixed-width
 * figures, so it does not jump as it counts. From 860 px the list is a static strip (or the mosaic) and the chip hides.
 */
export function Swipe({ count, label, children, className, listClassName }: SwipeProps) {
  const [index, setIndex] = useState(0);
  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div className={className}>
      {/* Focusable so arrow keys scroll it. */}
      <ul aria-label={label} tabIndex={0} onScroll={onScroll} className={listClassName}>
        {children}
      </ul>
      {count > 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 bottom-3 rounded-pp-chip bg-inverse/70 px-2.5 py-1 text-caption leading-none font-semibold text-on-inverse tabular-nums @desk:hidden"
        >
          {Math.min(index, count - 1) + 1}/{count}
        </span>
      )}
    </div>
  );
}
