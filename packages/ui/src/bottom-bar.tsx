import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** Pinned to the bottom of the viewport; in a min-h-dvh flex column it also sits at the bottom of short pages. */
export function BottomBar({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 mt-auto flex items-center gap-3 border-t border-hairline bg-surface px-4 pt-3 pb-safe",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The left-hand text of a bottom bar or sheet footer: optional small label, value, optional muted line. */
export function Summary({ label, value, sub, className }: { label?: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", className)}>
      {label && <span className="text-caption text-muted">{label}</span>}
      <strong className="truncate text-lg leading-tight font-semibold tracking-[-0.02em] tabular-nums">{value}</strong>
      {sub && <span className="text-caption text-muted">{sub}</span>}
    </div>
  );
}
