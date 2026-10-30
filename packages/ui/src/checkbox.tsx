import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode };

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 text-ui font-semibold has-disabled:text-disabled", className)}>
      <input type="checkbox" className="m-0 size-5.5 shrink-0 accent-brand" {...rest} />
      {label}
    </label>
  );
}
