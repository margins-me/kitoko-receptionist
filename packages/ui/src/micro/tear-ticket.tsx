"use client";

// Adapted from React Bits "Tear Ticket" (reactbits.dev/c/micro/tear-ticket, MIT).
// ponytail: motion drag with an elastic tug and a falling exit, instead of the original's paper-fibre physics,
// fixed-size clip paths and pointer tilt. Sideways drag only, so a vertical swipe still scrolls the page.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion, useMotionValue, useTransform } from "motion/react";
import { cn } from "../cn";

/** Pointer travel (px) or flick speed (px/s) that tears the stub off. */
const TEAR_AT = 72;
const FLICK = 650;

const stubVariants = { gone: { y: 180, rotate: 9, opacity: 0, transition: { duration: 0.5, ease: [0.5, 0, 0.75, 0] as const } } };
const wrapVariants = { gone: { height: 0, transition: { delay: 0.4, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const } } };

export type TearTicketProps = {
  /** The stub's face. Decorative only: never put anything here the client still needs. */
  children: ReactNode;
  /** Button name, e.g. "Détacher le talon". */
  label: string;
  /** Announced once torn, e.g. "Talon détaché". */
  tornLabel: string;
  onTear?: () => void;
  className?: string;
};

/**
 * A perforated stub to place right under a Ticket (it sets `data-stub`, so the ticket can square its bottom corners
 * with a `group-has-[[data-stub]]:rounded-b-none` class). Drag it sideways, flick it, tap it or press Enter: it falls away.
 */
export function TearTicket({ children, label, tornLabel, onTear, className }: TearTicketProps) {
  const [torn, setTorn] = useState(false);
  const dragged = useRef(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-120, 120], [-3, 3]);

  const tear = () => {
    if (torn) return;
    setTorn(true);
    onTear?.();
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {!torn && (
          <motion.div key="stub" data-stub="" exit="gone" variants={wrapVariants} className={cn("relative", className)}>
            <motion.button
              type="button"
              aria-label={label}
              variants={stubVariants}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.35}
              style={{ x, rotate }}
              onPointerDown={() => {
                dragged.current = false;
              }}
              onDragStart={() => {
                dragged.current = true;
              }}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > TEAR_AT || Math.abs(info.velocity.x) > FLICK) tear();
              }}
              onClick={() => {
                // A drag can end with a click too: only a plain tap or Enter/Space tears from here.
                if (!dragged.current) tear();
              }}
              className="block min-h-11 w-full cursor-grab touch-pan-y rounded-b-ticket bg-surface text-left shadow-ticket [clip-path:inset(0_-48px_-64px_-48px)] select-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus active:cursor-grabbing"
            >
              {children}
            </motion.button>
            <div aria-hidden className="pointer-events-none absolute inset-x-4.5 top-0 border-t-[1.5px] border-dashed border-dash">
              <span className="absolute -top-2.75 -left-7.5 size-5.5 rounded-full bg-ground" />
              <span className="absolute -top-2.75 -right-7.5 size-5.5 rounded-full bg-ground" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span role="status" className="sr-only">
        {torn ? tornLabel : ""}
      </span>
    </MotionConfig>
  );
}
