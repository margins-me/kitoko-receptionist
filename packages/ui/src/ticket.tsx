import type { ReactNode } from "react";
import { cn } from "./cn";

/** Confirmation ticket. Place it on the bg-ground surface so the side notches read as cut-outs. */
export function Ticket({ header, children, className }: { header: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative rounded-ticket bg-surface shadow-ticket", className)}>
      <div className="p-4.5">{header}</div>
      <div aria-hidden className="relative mx-4.5 border-t-[1.5px] border-dashed border-dash">
        <span className="absolute -top-2.75 -left-7.5 size-5.5 rounded-full bg-ground" />
        <span className="absolute -top-2.75 -right-7.5 size-5.5 rounded-full bg-ground" />
      </div>
      <div className="px-4.5 pt-3.5 pb-4.5">{children}</div>
    </div>
  );
}
