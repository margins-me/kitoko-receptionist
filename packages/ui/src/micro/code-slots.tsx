"use client";

// Adapted from React Bits "Code Slots" (reactbits.dev/c/micro/code-slots, MIT).
// ponytail: one real transparent <input> lies over the slots, so typing, paste, SMS autofill and form submission stay
// native; digits rise in with CSS instead of motion springs, and there is no success wash.
import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, InputHTMLAttributes } from "react";
import { cn } from "../cn";

export type CodeSlotsProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "maxLength"> & {
  /** Number of digits, e.g. 6. */
  length: number;
  defaultValue?: string;
  onValueChange?: (code: string) => void;
};

const digitsOf = (raw: string, length: number) => raw.replace(/\D/g, "").slice(0, length);

/** One-time code drawn as one box per digit. Spaces and dashes typed or pasted ("123 456") are dropped. */
export function CodeSlots({ length, defaultValue = "", onValueChange, className, onFocus, onBlur, onPaste, ...rest }: CodeSlotsProps) {
  const [code, setCode] = useState(() => digitsOf(defaultValue, length));
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const invalid = rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  const active = Math.min(code.length, length - 1);

  const set = (raw: string) => {
    const next = digitsOf(raw, length);
    setCode(next);
    onValueChange?.(next);
  };

  // React resets a form after its action; follow it so the slots never show digits the input no longer holds.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return undefined;
    const reset = () => setCode(digitsOf(defaultValue, length));
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, length]);

  return (
    <div className={cn("relative flex gap-2", className)}>
      {Array.from({ length }, (_, i) => {
        const here = focused && i === active;
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              "flex h-14 max-w-14 min-w-0 flex-1 items-center justify-center rounded-input border border-field bg-surface text-[22px] font-semibold tabular-nums transition-[border-color,box-shadow] duration-150",
              here && "border-ink ring-1 ring-ink",
              invalid && "border-danger",
              invalid && here && "ring-danger",
            )}
          >
            {code[i] ? (
              <span key={code[i]} className="animate-pop-in">
                {code[i]}
              </span>
            ) : (
              here && <span className="h-6 w-0.5 rounded-full bg-ink animate-caret-blink" />
            )}
          </span>
        );
      })}
      <input
        ref={input}
        type="text"
        value={code}
        onChange={(event) => set(event.target.value)}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          onPaste?.(event);
          // A pasted code replaces what is there, whatever text surrounds it ("Ton code : 123 456").
          const pasted = digitsOf(event.clipboardData.getData("text"), length);
          if (!pasted) return;
          event.preventDefault();
          set(pasted);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        // The caret always sits after the last digit, as the slots show it.
        onSelect={(event) => {
          const end = event.currentTarget.value.length;
          if (event.currentTarget.selectionStart !== end) event.currentTarget.setSelectionRange(end, end);
        }}
        className="absolute inset-0 m-0 size-full border-0 bg-transparent p-0 text-base text-transparent caret-transparent outline-none selection:bg-transparent"
        {...rest}
      />
    </div>
  );
}
