// Adapted from React Bits "Peek Rating" (reactbits.dev/c/micro/peek-rating, MIT).
// ponytail: CSS-only over native radios (form, arrow keys and screen readers for free); no floating tip, and the
// lift wave needs a hovering pointer, so touch gets the commit pop only.
import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import { cn } from "../cn";

// The lit/lift/pop rules live in styles.css under .pr-*.

export type PeekRatingProps = {
  /** Radio group name, unique on the page. */
  name: string;
  value: number;
  onChange: (value: number) => void;
  /** Accessible name of each star, e.g. "3 étoiles". */
  label: (value: number) => string;
  count?: number;
  className?: string;
};

/** Native radio stars: on hover they lift in a wave up to the pointer, and the picked one pops. */
export function PeekRating({ name, value, onChange, label, count = 5, className }: PeekRatingProps) {
  return (
    <div className={cn("pr-row flex gap-1", className)}>
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <label
          key={n}
          style={{ "--pr-i": n - 1 } as CSSProperties}
          className="pr-star flex size-11 cursor-pointer items-center justify-center rounded-full has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
        >
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
          <span className="sr-only">{label(n)}</span>
          <Star aria-hidden className="pr-glyph size-8" strokeWidth={1.6} />
        </label>
      ))}
    </div>
  );
}
