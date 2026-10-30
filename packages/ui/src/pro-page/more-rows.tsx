"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export type MoreRowsProps = {
  /** Id of the list, which the button controls. */
  id: string;
  /** "Voir les 3 autres prestations", then "Voir moins" once open. */
  more: string;
  fewer: string;
  /** The list's classes; its rows past the first ones carry `hidden group-data-open/rows:block` (server-rendered). */
  className: string;
  /** The rows: server-rendered <li>s. */
  children: ReactNode;
};

/**
 * A category's list with its last rows folded behind a button. Every row is in the HTML from the start, hidden by
 * CSS until the list carries data-open: nothing above moves when it opens, and the button stays where it was.
 */
export function MoreRows({ id, more, fewer, className, children }: MoreRowsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ul id={id} data-open={open ? "" : undefined} className={`group/rows ${className}`}>
        {children}
      </ul>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-pp-button text-ui font-semibold text-page-fg underline-offset-4 hover:underline"
      >
        {open ? fewer : more}
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-4 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </>
  );
}
