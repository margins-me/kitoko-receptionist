import type { ButtonHTMLAttributes } from "react";
import { iconButtonStyles } from "./button-styles";
import { cn } from "./cn";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  variant?: "outline" | "soft";
};

export function IconButton({ label, variant = "outline", type = "button", className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(iconButtonStyles({ variant }), className)}
      {...rest}
    >
      {children}
    </button>
  );
}
