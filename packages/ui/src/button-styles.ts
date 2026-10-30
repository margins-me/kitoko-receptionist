// Merge-free: no two keys set the same property, so the pro page can import this without tailwind-merge.
// Callers that add classes on top go through cn() (see <Button>).

const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const variants = {
  primary: "bg-brand text-on-brand",
  secondary: "bg-soft text-ink",
  outline: "border border-outline bg-surface text-ink",
  "danger-outline": "border border-outline bg-surface text-danger",
  ghost: "bg-transparent text-ink",
  danger: "bg-danger text-on-danger",
};

/** Replaces the variant's colours while off; borders keep their width so the size holds. */
const disabledVariants: Record<ButtonVariant, string> = {
  primary: "bg-hairline text-muted",
  secondary: "bg-hairline text-muted",
  outline: "border border-transparent bg-hairline text-muted",
  "danger-outline": "border border-transparent bg-hairline text-muted",
  ghost: "bg-transparent text-disabled",
  danger: "bg-hairline text-muted",
};

const sizes = {
  lg: "min-h-13.5 text-base desk:min-h-13",
  md: "min-h-12 text-ui",
  sm: "min-h-11 text-ui",
};

const paddings: Record<ButtonSize, string> = { lg: "px-6.5", md: "px-5", sm: "px-4" };

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

/** Height, text size and side padding of a button size, for button-like controls (e.g. <HoldButton>). */
export function buttonSize(size: ButtonSize = "lg"): string {
  return `${sizes[size]} ${paddings[size]}`;
}

/** Button look for links and other non-button elements. */
export function buttonStyles({
  variant = "primary",
  size = "lg",
  fullWidth = false,
  disabled = false,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; disabled?: boolean } = {}): string {
  return join(
    "inline-flex items-center justify-center gap-2 rounded-button font-semibold whitespace-nowrap transition-colors",
    disabled ? disabledVariants[variant] : variants[variant],
    sizes[size],
    paddings[size],
    // A ghost button reads as a text link. It keeps the size's padding (as it always rendered); a tight link passes px-1 via cn().
    variant === "ghost" ? "underline underline-offset-4" : "no-underline",
    fullWidth && "w-full",
    disabled && "cursor-not-allowed",
  );
}

const iconVariants = {
  outline: "border border-hairline bg-surface",
  soft: "bg-soft",
  /** No fill of its own, e.g. inside a <Stepper>. */
  plain: "",
};

export type IconButtonVariant = keyof typeof iconVariants;

/** 44 px round icon button look; greys out when disabled or aria-disabled. */
export function iconButtonStyles({ variant = "outline" }: { variant?: IconButtonVariant } = {}): string {
  return join(
    "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink disabled:text-disabled aria-disabled:text-disabled [&_svg]:size-4.5",
    iconVariants[variant],
  );
}
