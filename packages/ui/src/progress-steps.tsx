import { cn } from "./cn";

/** Segmented progress (3 segments by default). `label` is the spoken text, e.g. "Étape 2 sur 3". */
export function ProgressSteps({ current, total = 3, label, className }: { current: number; total?: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={label}
      className={cn("grid auto-cols-fr grid-flow-col gap-1.5", className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-1 rounded-full", i < current ? "bg-ink" : "bg-hairline")} />
      ))}
    </div>
  );
}
