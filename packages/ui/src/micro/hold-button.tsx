"use client";

// Adapted from React Bits "Hold Button" (reactbits.dev/c/micro/hold-button, MIT). No motion dependency.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../cn";
import { holdView } from "./hold-button-view";
import type { HoldPhase, HoldTone } from "./hold-button-view";

export type HoldButtonProps = {
  children: ReactNode;
  /** Shown once the hold completes, while `onHold` runs. */
  doneLabel?: ReactNode;
  /** Screen-reader hint, e.g. "Maintiens pour confirmer". */
  hint: string;
  /** Track and fill colours; default is the danger look. */
  tone?: HoldTone;
  holdTime?: number;
  loading?: boolean;
  disabled?: boolean;
  /** Fires after a full hold with a pointer, or at once on Enter/Space. */
  onHold: () => void;
  className?: string;
};

type Phase = HoldPhase;

const HIT_PAD = 10;
const RELEASE_MS = 200;
const LINEAR = (t: number) => t;
const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

// Fill and crest rules (clip path, wave mask, reduced motion) live in styles.css under .hb-*.

/** Press and hold to confirm a destructive action; a liquid fill rises while held and drains if released early. */
export function HoldButton({
  children,
  doneLabel,
  hint,
  tone = "danger",
  holdTime = 600,
  loading = false,
  disabled = false,
  onHold,
  className,
}: HoldButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ pointerId: number | null; start: number; rect: DOMRect | null }>({ pointerId: null, start: 0, rect: null });
  const completeTimer = useRef(0);
  const anim = useRef({ raf: 0, p: 0, from: 0, to: 0, start: 0 });
  const hintId = useId();
  const off = disabled || loading;

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const drive = (to: number, duration: number, ease: (t: number) => number) => {
    const m = anim.current;
    cancelAnimationFrame(m.raf);
    m.from = m.p;
    m.to = to;
    m.start = performance.now();
    const step = (now: number) => {
      const t = duration > 0 ? Math.min(1, (now - m.start) / duration) : 1;
      m.p = m.from + (m.to - m.from) * ease(t);
      buttonRef.current?.style.setProperty("--hb-p", m.p.toFixed(4));
      if (t < 1) m.raf = requestAnimationFrame(step);
      else {
        m.raf = 0;
        if (m.to === 1) complete();
      }
    };
    m.raf = requestAnimationFrame(step);
  };

  const complete = () => {
    if (phaseRef.current !== "holding") return;
    if (performance.now() - gesture.current.start < holdTime - 50) return;
    clearTimeout(completeTimer.current);
    go("done");
    onHold();
  };

  const release = () => {
    if (phaseRef.current !== "holding") return;
    clearTimeout(completeTimer.current);
    go("idle");
    drive(0, RELEASE_MS, EASE_OUT);
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  const endPointer = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== gesture.current.pointerId) return;
    gesture.current.pointerId = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    release();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (off || e.button !== 0 || !e.isPrimary || gesture.current.pointerId !== null || phaseRef.current !== "idle") return;
    gesture.current = { pointerId: e.pointerId, start: performance.now(), rect: e.currentTarget.getBoundingClientRect() };
    go("holding");
    drive(1, holdTime, LINEAR);
    completeTimer.current = window.setTimeout(complete, holdTime + 100);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const r = gesture.current.rect;
    if (e.pointerId !== gesture.current.pointerId || !r) return;
    const out = e.clientX < r.left - HIT_PAD || e.clientX > r.right + HIT_PAD || e.clientY < r.top - HIT_PAD || e.clientY > r.bottom + HIT_PAD;
    if (out) endPointer(e);
  };

  // ponytail: keyboard and switch users confirm at once; the hold only guards against stray taps.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat && !off && phaseRef.current === "idle") {
      e.preventDefault();
      buttonRef.current?.style.setProperty("--hb-p", "1");
      anim.current.p = 1;
      go("done");
      onHold();
    }
  };

  // Back to idle once the parent's action finishes (or fails) and the button is still mounted.
  useEffect(() => {
    if (!loading && phaseRef.current === "done") {
      const t = window.setTimeout(() => {
        go("idle");
        drive(0, RELEASE_MS, EASE_OUT);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [loading, phase]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return undefined;
    const measure = () => {
      button.style.setProperty("--hb-w", `${button.offsetWidth}px`);
      button.style.setProperty("--hb-h", `${button.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(button);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (phase !== "holding") return undefined;
    const cancel = () => releaseRef.current();
    const onVisibility = () => document.hidden && cancel();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase]);

  useEffect(() => {
    const m = anim.current;
    return () => {
      clearTimeout(completeTimer.current);
      cancelAnimationFrame(m.raf);
    };
  }, []);

  const view = holdView({ phase, tone, hasDoneLabel: doneLabel !== undefined, off, loading, className });
  const labels = (
    <>
      <span className={view.labelClass} aria-hidden={view.showDone}>
        {children}
      </span>
      {doneLabel !== undefined && (
        <span className={view.doneLabelClass} aria-hidden={!view.showDone}>
          {loading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
          {doneLabel}
        </span>
      )}
    </>
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-disabled={view.ariaDisabled}
      aria-busy={view.ariaBusy}
      aria-describedby={hintId}
      data-phase={phase}
      className={view.rootClass}
      style={{ "--hb-hold": `${holdTime}ms` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e)}
      onPointerCancel={(e) => endPointer(e)}
      onLostPointerCapture={(e) => endPointer(e)}
      onPointerLeave={(e) => e.pointerType !== "touch" && endPointer(e)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hb-label relative z-2 grid place-items-center">{labels}</span>
      <span className="pointer-events-none absolute inset-0 z-3 [clip-path:inset(0_round_9999px)]" aria-hidden>
        <span className={cn("hb-fill absolute inset-0 grid place-items-center", view.fillClass)}>
          <span className="hb-label grid place-items-center">{labels}</span>
        </span>
        <span className={cn("hb-crest absolute inset-0 grid place-items-center", view.fillClass)}>
          <span className="hb-label grid place-items-center">{labels}</span>
        </span>
      </span>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </button>
  );
}
