// Adapted from React Bits "Status Mark" (reactbits.dev/c/micro/status-mark, MIT).
// ponytail: CSS-only (no motion) so it can sit in the toast on every page; the ring spins instead of morphing.
import { cn } from "../cn";

export type StatusMarkStatus = "idle" | "running" | "done" | "failed";

const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";
const CROSS = "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5";
const DRAW = "fill-none stroke-current [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round] [stroke-dasharray:1_2] hidden";

/** Ring that spins while running, then draws a check (done) or a cross (failed). Decorative: say the status in text. */
export function StatusMark({ status, size = 20, className }: { status: StatusMarkStatus; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      data-status={status}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("group shrink-0 overflow-visible", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        pathLength="1"
        className="origin-center fill-current [fill-opacity:0] stroke-current [stroke-width:2] [stroke-linecap:round] [stroke-dasharray:1_0] opacity-40 [transition:fill-opacity_180ms_ease,opacity_200ms_ease,stroke-dasharray_300ms_ease] group-data-[status=running]:animate-spin group-data-[status=running]:[stroke-dasharray:0.68_0.32] group-data-[status=running]:opacity-100 group-data-[status=done]:[fill-opacity:0.08] group-data-[status=done]:opacity-100 group-data-[status=failed]:[fill-opacity:0.08] group-data-[status=failed]:opacity-100"
      />
      <path d={CHECK} pathLength="1" className={cn(DRAW, "group-data-[status=done]:inline group-data-[status=done]:animate-draw")} />
      <path d={CROSS} pathLength="1" className={cn(DRAW, "group-data-[status=failed]:inline group-data-[status=failed]:animate-draw")} />
    </svg>
  );
}
