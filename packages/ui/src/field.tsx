import { cloneElement, useId } from "react";
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactElement, ReactNode, TextareaHTMLAttributes } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "./cn";

const control =
  "w-full rounded-input border border-field bg-surface px-3.5 text-base text-ink placeholder:text-placeholder focus-visible:border-ink focus-visible:outline-offset-0 aria-invalid:border-danger disabled:bg-soft disabled:text-disabled";

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-semibold", className)} {...rest} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "min-h-13 desk:min-h-12.5", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-26 py-3 leading-normal", className)} {...rest} />;
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

/** Label, control, then helper or error text; wires id, aria-describedby and aria-invalid onto the child. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactElement<ControlProps>;
}) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, {
        id,
        "aria-describedby": note ? noteId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && !error && (
        <span id={noteId} className="text-caption text-muted">
          {hint}
        </span>
      )}
      {/* Always rendered so screen readers announce an error when it appears, focus or not; empty, it cancels its gap. */}
      <div aria-live="polite" aria-atomic className="empty:-mt-1.5">
        {error && (
          <span id={noteId} className="flex items-start gap-1.5 text-caption font-medium text-error">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
