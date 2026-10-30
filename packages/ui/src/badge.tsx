import type { ReactNode } from "react";
import { cn } from "./cn";

const TONES = { soft: "bg-soft", surface: "bg-surface" } as const;

/** A small soft pill: "Plus tard", "Par défaut", "15 min". `small` is the 12 px one. */
export function Badge({ tone = "soft", small, className, children }: { tone?: keyof typeof TONES; small?: boolean; className?: string; children: ReactNode }) {
  return <span className={cn("rounded-full px-2.5 font-semibold", small ? "py-1 text-xs" : "py-0.5 text-caption", TONES[tone], className)}>{children}</span>;
}
