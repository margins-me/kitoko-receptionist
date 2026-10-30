import type { HTMLAttributes, ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

const tones = {
  error: { box: "bg-error-bg text-error", Icon: CircleAlert, role: "alert" },
  warning: { box: "bg-warning text-ink", Icon: TriangleAlert, role: "status" },
  info: { box: "bg-soft text-ink", Icon: Info, role: "status" },
} as const;

export type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: keyof typeof tones;
  title?: ReactNode;
  /** Replaces the tone icon, e.g. a clock for the hold timer. */
  icon?: ReactNode;
};

export function Alert({ tone = "info", title, icon, className, children, ...rest }: AlertProps) {
  const { box, Icon, role } = tones[tone];
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-input px-3.5 py-3 text-sm", box, className)} {...rest}>
      <span aria-hidden className="mt-px shrink-0 [&_svg]:size-4">
        {icon ?? <Icon />}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <strong className="font-semibold">{title}</strong>}
        {children && <span>{children}</span>}
      </div>
    </div>
  );
}
