"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/** The bar's height: the observer counts her name as gone once it is under it (h-11 in index.tsx). */
const BAR_PX = 44;

export type NameBarProps = {
  /** Id of the header's name (h1 or p): the bar shows once it has scrolled out under the bar. */
  target: string;
  /** Id of the element that scrolls, for a preview scrolling inside its frame; none: the document. */
  scroller?: string;
  className: string;
  children: ReactNode;
};

/**
 * Phones: the slim bar (avatar, name, toolbar) above the stuck tabs once her name has scrolled away. One
 * IntersectionObserver, no scroll listener; CSS fades it in from data-shown. Server-rendered hidden; hidden, it is
 * inert, so its copies of the bag and share buttons are neither focusable nor announced.
 */
export function NameBar({ target, scroller, className, children }: NameBarProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const name = document.getElementById(target);
    if (!name || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Out of view above the bar's line, not below the fold (a frame not laid out yet reports that too).
        const line = entry.rootBounds?.top ?? BAR_PX;
        setShown(!entry.isIntersecting && entry.boundingClientRect.top < line);
      },
      { root: scroller ? document.getElementById(scroller) : null, rootMargin: `-${BAR_PX}px 0px 0px 0px` },
    );
    observer.observe(name);
    return () => observer.disconnect();
  }, [target, scroller]);

  return (
    <div data-shown={shown ? "" : undefined} inert={!shown} className={className}>
      {children}
    </div>
  );
}
