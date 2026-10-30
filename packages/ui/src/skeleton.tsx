import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Placeholder block while content loads; size it with className (e.g. "h-5 w-32"). Hidden from screen readers. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-md bg-soft motion-safe:animate-pulse", className)} {...rest} />;
}

/** `lines` text-height skeleton lines, the last one shorter like the end of a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", lines > 1 && i === lines - 1 && "w-3/5")} />
      ))}
    </div>
  );
}
