// Adapted from React Bits "Spring Check" (reactbits.dev/c/micro/spring-check, MIT).
// ponytail: CSS-only on a native checkbox; the fill springs in with an overshooting curve and the tick draws after it,
// without the strike-through on the label.
import type { InputHTMLAttributes } from "react";
import { cn } from "../cn";

/** A native checkbox (pass `role="switch"` if needed) whose box fills with a spring and draws its tick. 20 px; wrap it in a label for the tap target. */
export function SpringCheck({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={cn("relative inline-grid size-5 shrink-0 place-items-center transition-transform duration-150 has-[input:enabled:active]:scale-90", className)}>
      <input
        type="checkbox"
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-md border-[1.5px] border-field bg-surface transition-colors checked:border-inverse disabled:cursor-not-allowed disabled:opacity-50"
        {...rest}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 scale-0 rounded-md bg-inverse transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] peer-checked:scale-100 peer-disabled:opacity-50"
      />
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none relative size-[72%] fill-none stroke-on-inverse [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3] peer-checked:[--sc-dash:0] peer-checked:[--sc-delay:90ms]"
      >
        <path
          d="M5 12.5 10 17.5 19 7"
          pathLength="1"
          className="[stroke-dasharray:1_2] [stroke-dashoffset:var(--sc-dash,1.05)] [transition:stroke-dashoffset_200ms_var(--ease-out-quint)_var(--sc-delay,0ms)]"
        />
      </svg>
    </span>
  );
}
