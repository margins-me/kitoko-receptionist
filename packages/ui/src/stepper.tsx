"use client";

import { Minus, Plus } from "lucide-react";
import { iconButtonStyles } from "./button-styles";
import { cn } from "./cn";

export function Stepper({
  value,
  onValueChange,
  min = 1,
  max = 99,
  decrementLabel,
  incrementLabel,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  /** e.g. "Retirer un bonnet en satin" */
  decrementLabel: string;
  incrementLabel: string;
  className?: string;
}) {
  const step = iconButtonStyles({ variant: "plain" });
  const change = (next: number) => {
    if (next >= min && next <= max) onValueChange(next);
  };
  return (
    <div className={cn("inline-flex items-center rounded-full border border-hairline", className)}>
      <button type="button" aria-label={decrementLabel} aria-disabled={value <= min || undefined} onClick={() => change(value - 1)} className={step}>
        <Minus aria-hidden />
      </button>
      <output aria-live="polite" className="min-w-6 text-center font-semibold tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={incrementLabel} aria-disabled={value >= max || undefined} onClick={() => change(value + 1)} className={step}>
        <Plus aria-hidden />
      </button>
    </div>
  );
}
