"use client";

import { useId } from "react";
import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { LoaderCircle } from "lucide-react";
import type { ButtonSize, ButtonVariant } from "./button-styles";
import { buttonState } from "./button-state";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  /** Shown under the button while it is disabled, and read with it. */
  reason?: string;
  /** Called on a click while disabled (not while loading), e.g. to show what is missing. */
  onBlockedClick?: () => void;
};

export function Button({
  variant = "primary",
  size = "lg",
  fullWidth,
  loading,
  reason,
  disabled,
  className,
  type = "button",
  onClick,
  onBlockedClick,
  children,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const state = buttonState({ variant, size, fullWidth, loading, reason, disabled, className });

  // aria-disabled instead of disabled keeps the button focusable, so its reason can be heard.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!state.off) return onClick?.(event);
    event.preventDefault();
    if (disabled && !loading) onBlockedClick?.();
  };

  const button = (
    <button
      type={type}
      aria-disabled={state.ariaDisabled}
      aria-busy={state.ariaBusy}
      aria-describedby={state.showReason ? reasonId : undefined}
      onClick={handleClick}
      className={state.buttonClass}
      {...rest}
    >
      {loading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
      {children}
    </button>
  );

  if (!state.showReason) return button;
  return (
    <span className={state.wrapperClass}>
      {button}
      <span id={reasonId} className="text-caption text-muted">
        {reason}
      </span>
    </span>
  );
}
