import type { ElementType, ReactNode } from "react";
import { CalendarDays, Plus, ShoppingBag, Sun, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../cn";

// The pro app's phone navigation: four tabs and the central "+". The dashboard places it (fixed, hidden on desktop)
// through `className`, renders its links with next/link and slides the active bar with `indicator`; without one,
// the active tab's bar is drawn in place.

const ICONS: Partial<Record<string, LucideIcon>> = { today: Sun, agenda: CalendarDays, shop: ShoppingBag, page: UserRound };

export type ProTab = { id: string; href: string; label: string };

export type ProTabBarProps = {
  start: readonly ProTab[];
  end: readonly ProTab[];
  /** The current tab's id; none outside any tab (e.g. Réglages). */
  active: string | null;
  /** nav: the bar's accessible name ("Navigation"); add: the "+" button's ("Ajouter"). */
  labels: { nav: string; add: string };
  onAdd?: () => void;
  /** The add sheet is open (aria-expanded). */
  addOpen?: boolean;
  /** The links' element, e.g. next/link. Default <a>. */
  link?: ElementType;
  /** Drawn first in the bar, e.g. the sliding <SegmentIndicator>. */
  indicator?: ReactNode;
  className?: string;
};

export function ProTabBar({ start, end, active, labels, onAdd, addOpen, link = "a", indicator, className }: ProTabBarProps) {
  return (
    <nav aria-label={labels.nav} className={cn("grid grid-cols-5 items-center border-t border-hairline bg-surface px-1 pt-1.5", className)}>
      {indicator}
      {start.map((item) => (
        <Tab key={item.id} item={item} active={active} link={link} />
      ))}
      <button
        type="button"
        aria-label={labels.add}
        aria-haspopup="dialog"
        aria-expanded={addOpen}
        onClick={onAdd}
        className="flex size-13 items-center justify-center justify-self-center rounded-full bg-inverse text-on-inverse"
      >
        <Plus aria-hidden className="size-5.5" strokeWidth={2.2} />
      </button>
      {end.map((item) => (
        <Tab key={item.id} item={item} active={active} link={link} />
      ))}
    </nav>
  );
}

function Tab({ item, active, link: Link }: { item: ProTab; active: string | null; link: ElementType }) {
  const current = item.id === active;
  const Icon = ICONS[item.id];
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-13 min-w-0 flex-col items-center justify-center gap-0.5 rounded-input text-[11px] leading-tight focus-visible:-outline-offset-2",
        current ? "font-semibold text-ink" : "font-medium text-muted",
      )}
    >
      <span aria-hidden data-bar className={cn("mb-0.5 h-[3px] w-5.5 rounded-full", current ? "bg-ink [[data-seg]_&]:bg-transparent" : "bg-transparent")} />
      {Icon && <Icon aria-hidden className="size-5.5" strokeWidth={current ? 2.2 : 1.8} />}
      {/* Two lines rather than an ellipsis: "La mia pagina" does not fit a fifth of 390 px on one. */}
      <span className="line-clamp-2 max-w-full px-0.5 text-center">{item.label}</span>
    </Link>
  );
}
