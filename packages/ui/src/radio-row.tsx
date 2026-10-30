"use client";

import type { ReactNode } from "react";
import { ChoiceGroup, choiceFocus, useChoice } from "./choice";
import type { ChoiceGroupProps } from "./choice";
import { cn } from "./cn";

export function RadioRows(props: ChoiceGroupProps) {
  return <ChoiceGroup {...props} listClassName="flex flex-col gap-2" />;
}

export function RadioRow({
  value,
  label,
  hint,
  aside,
  detail,
  disabled,
}: {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Right-hand text before the ring, e.g. "4,90 €". */
  aside?: ReactNode;
  /** Full-width content under the row (e.g. what a plan includes); the row then aligns to the top. */
  detail?: ReactNode;
  disabled?: boolean;
}) {
  const { input } = useChoice(value);
  return (
    <label
      className={cn(
        "group flex min-h-14.5 flex-col justify-center gap-3 rounded-chip border-[1.5px] border-hairline bg-surface px-4 text-left",
        detail ? "py-4" : "py-2",
        choiceFocus,
        "has-checked:border-brand has-disabled:cursor-not-allowed has-disabled:text-disabled",
      )}
    >
      <input {...input} disabled={disabled} />
      <span className={cn("flex justify-between gap-3", detail ? "items-start" : "items-center")}>
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{label}</span>
          {hint && <span className="text-caption text-muted">{hint}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {aside && <span className="font-semibold tabular-nums">{aside}</span>}
          <span
            aria-hidden
            className="size-5 shrink-0 rounded-full border-[1.5px] border-ring-off group-has-checked:border-[6px] group-has-checked:border-brand"
          />
        </span>
      </span>
      {detail}
    </label>
  );
}
