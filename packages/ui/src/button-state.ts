import { buttonStyles } from "./button-styles";
import type { ButtonSize, ButtonVariant } from "./button-styles";
import { cn } from "./cn";

// Pure rules behind <Button>: when it is off, when its reason shows, and the classes of the button and its wrapper.
// Kept apart so tests run them without a DOM.

export type ButtonStateInput = {
  variant: ButtonVariant;
  size: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  reason?: string;
  disabled?: boolean;
  className?: string;
};

export function buttonState({ variant, size, fullWidth, loading, reason, disabled, className }: ButtonStateInput) {
  const off = Boolean(disabled || loading);
  const showReason = Boolean(disabled && reason);
  return {
    off,
    showReason,
    ariaDisabled: off || undefined,
    ariaBusy: loading || undefined,
    buttonClass: cn(buttonStyles({ variant, size, fullWidth: fullWidth || showReason, disabled: off }), !showReason && className),
    /** Only rendered while the reason shows. */
    wrapperClass: cn("inline-flex flex-col gap-1.5", fullWidth && "w-full", className),
  };
}
