// Adapted from React Bits "Bell Toggle" (reactbits.dev/c/micro/bell-toggle, MIT).
// ponytail: CSS-only (no motion, no measuring): labels stack in one grid cell so the pill keeps its widest size,
// and "unfurl" is an ink fill wiping across instead of a clip-path reveal. No badge, waves or clapper.
"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "../cn";
import { StatusMark } from "./status-mark";

const FADE = "[grid-area:1/1] transition-[opacity,filter] duration-200";

/**
 * Pill that rings its bell when pressed, then (once `on`) fills in the inverse colour and crossfades to `onLabel` with
 * a drawn check. One-way: pressing it while on does nothing (aria-disabled, so focus stays put).
 */
export function BellToggle({
  on,
  offLabel,
  onLabel,
  onPress,
  className,
}: {
  on: boolean;
  offLabel: string;
  onLabel: string;
  onPress: () => void;
  className?: string;
}) {
  // Bumped per press: a new key restarts the ring.
  const [rings, setRings] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={on || undefined}
      data-on={on}
      onClick={() => {
        if (on) return;
        setRings(rings + 1);
        onPress();
      }}
      className={cn(
        "group inline-flex min-h-11.5 items-center gap-2 self-start rounded-full border border-ink bg-surface px-4.5 font-semibold text-ink",
        "bg-[linear-gradient(var(--color-inverse),var(--color-inverse))] bg-[length:0%_100%] bg-no-repeat transition-[background-size,color,scale] duration-300 ease-out",
        "active:not-aria-disabled:scale-97 aria-disabled:cursor-default data-[on=true]:bg-[length:100%_100%] data-[on=true]:text-on-inverse",
        className,
      )}
    >
      <span className="grid size-5 shrink-0">
        <Bell
          key={rings}
          aria-hidden
          strokeWidth={2.2}
          className={cn(FADE, "size-5 origin-[50%_16%] group-data-[on=true]:opacity-0", rings > 0 && "animate-bell-ring")}
        />
        <StatusMark status={on ? "done" : "idle"} className={cn(FADE, "opacity-0 group-data-[on=true]:opacity-100")} />
      </span>
      <span className="grid text-left">
        <span aria-hidden={on} className={cn(FADE, "group-data-[on=true]:opacity-0 group-data-[on=true]:blur-[2px]")}>
          {offLabel}
        </span>
        <span aria-hidden={!on} className={cn(FADE, "opacity-0 blur-[2px] group-data-[on=true]:opacity-100 group-data-[on=true]:blur-none")}>
          {onLabel}
        </span>
      </span>
    </button>
  );
}
