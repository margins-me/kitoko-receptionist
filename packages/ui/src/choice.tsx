"use client";

import { createContext, useContext, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ChoiceGroupProps = {
  legend: ReactNode;
  /** Form field name; generated when omitted. */
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
};

type Choice = Omit<ChoiceGroupProps, "legend" | "children" | "className"> & { name: string; pill?: boolean };

const ChoiceContext = createContext<Choice | null>(null);

/** Native radios in a fieldset: arrow keys, forms and screen readers work without extra code. */
export function ChoiceGroup({
  legend,
  name,
  className,
  listClassName,
  children,
  ...rest
}: ChoiceGroupProps & { listClassName: string; pill?: boolean }) {
  const fallbackName = useId();
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <ChoiceContext value={{ ...rest, name: name ?? fallbackName }}>
        <div className={listClassName}>{children}</div>
      </ChoiceContext>
    </fieldset>
  );
}

export function useChoice(value: string): { input: InputHTMLAttributes<HTMLInputElement>; pill: boolean } {
  const group = useContext(ChoiceContext);
  if (!group) throw new Error("A choice must be rendered inside its group (ChipGroup or RadioRows).");
  return {
    pill: Boolean(group.pill),
    input: {
      type: "radio",
      name: group.name,
      value,
      className: "sr-only",
      ...(group.value === undefined ? { defaultChecked: group.defaultValue === value } : { checked: group.value === value }),
      onChange: () => group.onValueChange?.(value),
    },
  };
}

export const choiceFocus = "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";
