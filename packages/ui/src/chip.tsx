"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChoiceGroup, choiceFocus, useChoice } from "./choice";
import type { ChoiceGroupProps } from "./choice";
import { cn } from "./cn";

const tile =
  "flex min-h-14.5 flex-col items-center justify-center rounded-chip border-[1.5px] border-hairline bg-surface p-1.5 text-center text-ink";
const pill = "inline-flex min-h-11 items-center justify-center rounded-full border-[1.5px] border-hairline bg-surface px-4 text-ink";
/** `selected:` = checked radio inside, or aria-pressed (styles.css). */
const selected = "selected:border-brand selected:bg-brand selected:text-on-brand";
const selectedHint = "text-xs text-muted group-selected:text-on-brand";
const grids = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

/** Single choice. "tile" = 58 px option grid, "pill" = wrapping 44 px pills (e.g. colours). */
export function ChipGroup({
  variant = "tile",
  columns = 3,
  ...rest
}: ChoiceGroupProps & { variant?: "tile" | "pill"; columns?: keyof typeof grids }) {
  const isPill = variant === "pill";
  return <ChoiceGroup {...rest} pill={isPill} listClassName={isPill ? "flex flex-wrap gap-2" : cn("grid gap-2", grids[columns])} />;
}

export function Chip({
  value,
  label,
  hint,
  disabled,
}: {
  value: string;
  label: ReactNode;
  /** Second line under the label, e.g. "+20 €". */
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { input, pill: isPill } = useChoice(value);
  return (
    <label
      className={cn(
        "group",
        isPill ? pill : tile,
        choiceFocus,
        selected,
        // has-disabled:selected: keeps the disabled text over the selected look, as before the variant existed.
        "has-disabled:cursor-not-allowed has-disabled:text-disabled has-disabled:selected:text-disabled",
      )}
    >
      <input {...input} disabled={disabled} />
      <span className="font-semibold">{label}</span>
      {hint && <span className={selectedHint}>{hint}</span>}
    </label>
  );
}

/** Chip look for a multi-select option (e.g. extras). Group several in a fieldset with a legend. */
export function ToggleChip({
  pressed,
  onPressedChange,
  label,
  hint,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "onClick"> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn("group", tile, "px-2.5", selected, className)}
      {...rest}
    >
      <span className="font-semibold">{label}</span>
      {hint && <span className={selectedHint}>{hint}</span>}
    </button>
  );
}
