import { cn } from "./cn";
import { formatEur } from "./format";

export function Price({ cents, locale, className }: { cents: number; locale: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatEur(cents, locale)}</span>;
}
