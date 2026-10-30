"use client";

import { useTranslations } from "next-intl";
import { Alert, cn } from "@kitoko/ui";
import { Clock, TriangleAlert } from "@kitoko/ui/icons";
import { formatLeft, HOLD_SECONDS } from "./format";

const WARN_SECONDS = 120;

/** "Slot held for 9:42", with a honey fuse burning down; amber with a warning icon in the last two minutes. */
export function HoldTimer({ secondsLeft }: { secondsLeft: number }) {
  const t = useTranslations("pay.hold");
  const urgent = secondsLeft <= WARN_SECONDS;
  return (
    <Alert tone={urgent ? "warning" : "info"} role="timer" aria-live="off" icon={urgent ? <TriangleAlert /> : <Clock />} className={cn("relative min-h-13 pt-2.5 pb-4.5", !urgent && "bg-surface")}>
      {/* The fuse: a track clear of the rounded corners, the bar shrinking one linear step per tick. */}
      <span aria-hidden className="absolute inset-x-4 bottom-2.5 h-1 overflow-hidden rounded-full bg-current/10">
        <span
          className="block h-full origin-left rounded-full bg-honey transition-transform duration-1000 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, secondsLeft / HOLD_SECONDS))})` }}
        />
      </span>
      <span className="tabular-nums">
        {t.rich("left", { time: formatLeft(secondsLeft), b: (chunks) => <strong className="font-semibold">{chunks}</strong> })}
      </span>
    </Alert>
  );
}
