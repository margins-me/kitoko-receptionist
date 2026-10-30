import type { ElementType } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../button";
import { cn } from "../cn";
import type { HourRange } from "./geometry";
import { HourLines, TimelineView } from "./timeline";
import type { TimelineEntry } from "./timeline";

// Desktop week (T01): its title and actions, the KPIs, and the working days side by side. Display-ready: the
// dashboard keeps the panel beside it and wires the taps; the landing draws it inside a browser frame.

const PX_PER_MINUTE = 48 / 60;

export type WeekAction = { label: string; primary?: boolean; onClick?: () => void };
export type WeekKpi = { id: string; value: string; label: string };
export type WeekDay = {
  key: string;
  /** "Lun" */
  weekday: string;
  /** "19" */
  day: string;
  /** The section's accessible name: "Lundi 19 octobre". */
  label: string;
  today?: boolean;
  /** "Ouvert, 3 en attente" */
  status: string;
  /** Still open to bookings: the status in ink, else muted. */
  open: boolean;
  entries: TimelineEntry[];
};

export type AgendaWeekViewProps = {
  /** "Semaine du 19 octobre" */
  title: string;
  as?: "h1" | "h2" | "p";
  prev: { href: string; label: string };
  next: { href: string; label: string };
  /** The links' element, e.g. next/link. Default <a>. */
  link?: ElementType;
  actions: WeekAction[];
  kpis: WeekKpi[];
  days: WeekDay[];
  range: HourRange;
  /** For the hour labels. */
  locale: string;
  /** kpis: the KPI list's accessible name; today: said after today's date; noWorkingDays: an empty week. */
  labels: { kpis: string; today: string; noWorkingDays: string };
  className?: string;
};

export function AgendaWeekView({ title, as: H = "h1", prev, next, link: Link = "a", actions, kpis, days, range, locale, labels, className }: AgendaWeekViewProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <H className="text-page-title font-medium">{title}</H>
          <Link href={prev.href} aria-label={prev.label} className="flex size-11 items-center justify-center rounded-full border border-hairline bg-surface">
            <ChevronLeft aria-hidden className="size-4.5" />
          </Link>
          <Link href={next.href} aria-label={next.label} className="flex size-11 items-center justify-center rounded-full border border-hairline bg-surface">
            <ChevronRight aria-hidden className="size-4.5" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button key={action.label} variant={action.primary ? "primary" : "outline"} size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <ul aria-label={labels.kpis} className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {kpis.map((kpi) => (
          <li key={kpi.id} className="flex flex-col rounded-chip border border-hairline bg-surface p-3.5">
            <strong className="text-[22px] font-semibold tabular-nums">{kpi.value}</strong>
            <span className="text-caption text-muted">{kpi.label}</span>
          </li>
        ))}
      </ul>

      <WeekGrid days={days} range={range} locale={locale} labels={labels} />
    </div>
  );
}

/** The working days side by side: their heads, then their timelines over the shared hour lines. */
function WeekGrid({ days, range, locale, labels }: Pick<AgendaWeekViewProps, "days" | "range" | "locale" | "labels">) {
  const height = (range.to - range.from) * PX_PER_MINUTE;
  if (days.length === 0) return <p className="rounded-card border border-hairline bg-surface p-5 text-muted">{labels.noWorkingDays}</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-hairline bg-surface px-3 pt-3 pb-4">
      <div className="grid min-w-160 gap-x-1.5" style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <div key={d.key} className="flex flex-col px-1 pt-1.5 pb-2.5">
            <span className="text-xs text-muted">{d.weekday}</span>
            <strong className={cn("text-base font-semibold tabular-nums", d.today && "underline underline-offset-4")}>
              {d.day}
              {d.today && <span className="sr-only">, {labels.today}</span>}
            </strong>
            <span className={cn("text-caption", d.open ? "text-ink" : "text-muted", "text-xs")}>{d.status}</span>
          </div>
        ))}
        <div className="relative" style={{ height }}>
          <HourLines range={range} pxPerMinute={PX_PER_MINUTE} locale={locale} />
        </div>
        {days.map((d) => (
          <section key={d.key} aria-label={d.label} className="relative rounded-input bg-canvas" style={{ height }}>
            <HourLines range={range} pxPerMinute={PX_PER_MINUTE} locale={locale} labels={false} />
            <TimelineView entries={d.entries} range={range} pxPerMinute={PX_PER_MINUTE} minHeight={40} compact className="mx-[3px]" />
          </section>
        ))}
      </div>
    </div>
  );
}
