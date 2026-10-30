"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode, UIEvent } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useBackToClose } from "../use-back-to-close";
import type { PageImage } from "./types";

export type PhotoViewerProps = {
  photos: PageImage[];
  closeLabel: string;
  /** The grid: each photo a button carrying `data-photo` (its index), so a tap opens the viewer on it. */
  children: ReactNode;
  /** On the grid's wrapper, e.g. to let it fill a fixed frame. */
  className?: string;
};

/**
 * What says a photo opens fullscreen, on touch too (the zoom cursor is a mouse hint only): an expand mark in its
 * corner, on the dark of the viewer it opens. The button carries the label; the button must be `relative`.
 */
export function ExpandMark({ size }: { size: "band" | "tile" }) {
  const box = size === "band" ? "right-2.5 bottom-2.5 size-8 [&_svg]:size-4" : "right-1.5 bottom-1.5 size-6 [&_svg]:size-3.5";
  return (
    <span aria-hidden className={`pointer-events-none absolute grid place-items-center rounded-full bg-inverse/70 text-on-inverse ${box}`}>
      <Maximize2 strokeWidth={2.2} />
    </span>
  );
}

/**
 * The Photos tab's fullscreen slideshow: a native modal <dialog> (focus, Esc and the top layer come with it) holding
 * every photo in a scroll-snap strip, so swiping and the arrow keys need no code. The phone's back button closes it,
 * like the sheets. The arrows are a mouse convenience, hidden from assistive tech: the strip itself takes the keys.
 */
export function PhotoViewer({ photos, closeLabel, children, className }: PhotoViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  /** The tapped photo, where the strip starts. */
  const start = useRef(0);
  useBackToClose(open, setOpen, true);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (!open) {
      if (el.open) el.close();
      return;
    }
    if (el.open) return;
    el.showModal();
    // Laid out by now: start on the tapped photo, with the keys on the strip.
    const list = strip.current;
    list?.scrollTo({ left: start.current * list.clientWidth, behavior: "instant" });
    list?.focus({ preventScroll: true });
  }, [open]);

  const show = (i: number) => {
    const list = strip.current;
    if (list) list.scrollTo({ left: i * list.clientWidth, behavior: "smooth" });
  };

  const onGridClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-photo]");
    if (!target) return;
    start.current = Number(target.dataset.photo);
    setIndex(start.current);
    setOpen(true);
  };

  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  const arrow = "absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-on-photo/15 text-on-photo hover:bg-on-photo/25 sm:flex";

  return (
    <div onClick={onGridClick} className={className}>
      {children}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-photo-scrim p-0 text-on-photo backdrop:bg-photo-scrim"
      >
        <ul
          ref={strip}
          tabIndex={0}
          onScroll={onScroll}
          className="flex size-full snap-x snap-mandatory overflow-x-auto overscroll-contain outline-none [scrollbar-width:none]"
        >
          {photos.map((photo) => (
            <li key={photo.src} className="flex size-full shrink-0 snap-center items-center justify-center">
              <img
                src={photo.src}
                srcSet={photo.srcSet}
                sizes="100vw"
                alt={photo.alt}
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="absolute top-4 left-1/2 -translate-x-1/2 text-sm tabular-nums text-on-photo/80">
          {index + 1} / {photos.length}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={closeLabel}
          className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full bg-on-photo/15 hover:bg-on-photo/25"
        >
          <X className="size-5" />
        </button>
        {index > 0 && (
          <button type="button" aria-hidden tabIndex={-1} onClick={() => show(index - 1)} className={`${arrow} left-3`}>
            <ChevronLeft className="size-6" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button type="button" aria-hidden tabIndex={-1} onClick={() => show(index + 1)} className={`${arrow} right-3`}>
            <ChevronRight className="size-6" />
          </button>
        )}
      </dialog>
    </div>
  );
}
