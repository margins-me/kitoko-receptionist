import { buttonSize } from "../button-styles";
import { cn } from "../cn";

// Pure rules behind <HoldButton>'s look: which label shows and the classes and ARIA state that follow from the phase.
// Kept apart so tests run them without a DOM.

export type HoldPhase = "idle" | "holding" | "done";
export type HoldTone = "danger" | "brand";

/** Track (the button) and fill (the liquid, with its own text colour) per tone. */
const TONES = {
  danger: { track: "bg-error-bg text-danger", fill: "bg-danger text-on-danger" },
  brand: { track: "bg-soft text-ink", fill: "bg-brand text-on-brand" },
};

const LABEL_SPAN = "[grid-area:1/1] inline-flex items-center gap-2 whitespace-nowrap [transition:opacity_200ms_ease,filter_200ms_ease]";
const HIDDEN_LABEL = "opacity-0 blur-[2px]";
const ROOT = `hb-root group relative isolate inline-grid ${buttonSize("lg")} touch-manipulation select-none place-items-center rounded-full font-semibold [-webkit-touch-callout:none] transition-[scale] duration-160 ease-out-quint data-[phase=holding]:scale-97`;

export function holdView({
  phase,
  tone = "danger",
  hasDoneLabel,
  off,
  loading,
  className,
}: {
  phase: HoldPhase;
  tone?: HoldTone;
  hasDoneLabel: boolean;
  off: boolean;
  loading: boolean;
  className?: string;
}) {
  const showDone = phase === "done" && hasDoneLabel;
  return {
    showDone,
    ariaDisabled: off || undefined,
    ariaBusy: loading || undefined,
    labelClass: cn(LABEL_SPAN, showDone && HIDDEN_LABEL),
    doneLabelClass: cn(LABEL_SPAN, !showDone && HIDDEN_LABEL),
    rootClass: cn(ROOT, TONES[tone].track, off && phase === "idle" && "cursor-not-allowed opacity-50", className),
    fillClass: TONES[tone].fill,
  };
}
