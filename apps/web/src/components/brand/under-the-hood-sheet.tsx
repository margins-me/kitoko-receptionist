"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { Menu, X } from "@kitoko/ui/icons";

// The header's "Explore" button: a native <dialog> that rises from the bottom on phones and slides in from the
// right on wider screens. Esc, the close button and a tap on the backdrop close it.

export function UnderTheHoodSheet({ label, title, closeLabel, children }: { label: string; title: string; closeLabel: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-stone-line bg-surface px-3 text-ui font-semibold text-ink hover:border-ink sm:px-4"
      >
        <Menu aria-hidden className="size-4.5" />
        <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">{label}</span>
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="sheet m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-[24px] bg-stone p-0 text-ink backdrop:bg-ink/40 sm:mt-0 sm:ml-auto sm:h-dvh sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-[24px]"
      >
        <div className="px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-6">
          <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-stone-line sm:hidden" />
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[22px] leading-tight font-bold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label={closeLabel}
              className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}
