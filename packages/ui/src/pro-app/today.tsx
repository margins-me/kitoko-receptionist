import type { ReactNode } from "react";
import { Badge } from "../badge";
import { Button } from "../button";
import { cn } from "../cn";

// Aujourd'hui (P01, P10), the pro's phone home: its header, a cancellation card and a day's list. Display-ready:
// the dashboard formats the words and wires the taps, the landing passes sample words and no callbacks.

const card = "flex flex-col gap-2 rounded-card p-4";

type Heading = "h1" | "h2" | "p";

/** "Mardi 20 octobre" over "Bonjour Nala". */
export function TodayHeader({ date, title, as: H = "h1" }: { date: string; title: string; as?: Heading }) {
  return (
    <header className="flex flex-col">
      <span className="text-sm text-muted">{date}</span>
      <H className="text-title leading-[1.1] font-medium tracking-display">{title}</H>
    </header>
  );
}

/** A client cancelled: who and when, what happened to the money, then the freed slot (`children`, an <OfferLine>). */
export function CancellationCard({ title, body, error, children }: { title: string; body: string; error?: string | null; children?: ReactNode }) {
  return (
    <div role="status" className={cn(card, "bg-warning")}>
      <strong className="font-semibold">{title}</strong>
      <span className="text-sm text-body">{body}</span>
      {children}
      {error && <p className="text-sm font-semibold text-error">{error}</p>}
    </div>
  );
}

export type OfferLineProps = {
  /** offered: who it went to; nobody: nobody took it; noWaitlist: nobody waits; cta: the button to offer it. */
  kind: "offered" | "nobody" | "noWaitlist" | "cta";
  text: string;
  pending?: boolean;
  onOffer?: () => void;
};

/** A freed slot: who it went to, or the button to offer it. */
export function OfferLine({ kind, text, pending, onOffer }: OfferLineProps) {
  if (kind === "offered") return <p className="text-sm font-semibold">{text}</p>;
  if (kind === "nobody") return <p className="text-sm">{text}</p>;
  if (kind === "noWaitlist") return <p className="text-sm text-body">{text}</p>;
  return (
    <Button size="sm" className="self-start whitespace-normal" loading={pending} onClick={onOffer}>
      {text}
    </Button>
  );
}

/**
 * A day's bookings, blocks and free gaps, by start: `children` are <BookingRow>, <GapRow> and <BlockRow>.
 * `closed` replaces the list (a closed day with nothing on it); `nothing` ends it (no booking and no gap).
 */
export function DayList({
  id,
  title,
  as: H = "h2",
  closed,
  nothing,
  children,
}: {
  /** The heading's id, unique per document. */
  id: string;
  title: string;
  as?: Heading;
  closed?: string | null;
  nothing?: string | null;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <H id={id} className="text-lg font-semibold">
        {title}
      </H>
      {closed ? (
        <p className="text-sm text-muted">{closed}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {children}
          {nothing && <li className="text-sm text-muted">{nothing}</li>}
        </ul>
      )}
    </section>
  );
}

/** A booking of the day: time, client, service, products to hand over and its tags ("Payé", "Reste 115 €"). */
export function BookingRow({
  time,
  name,
  service,
  state,
  handOver,
  tags,
  onClick,
}: {
  /** "9 h – 11 h" */
  time: string;
  name: string;
  service: string;
  /** pending: held or waiting for its deposit; noShow: the client did not come (name struck). */
  state?: "pending" | "noShow";
  /** "À remettre : Bonnet en satin", or that it was handed over. */
  handOver?: string | null;
  tags: string[];
  onClick?: () => void;
}) {
  const noShow = state === "noShow";
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full gap-3 rounded-card border border-hairline bg-surface p-3.5 text-left">
        <span aria-hidden className={cn("w-1 shrink-0 rounded-full", state === "pending" ? "bg-honey" : noShow ? "bg-grip" : "bg-ink")} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-muted">{time}</span>
          <strong className={cn("font-semibold", noShow && "text-muted line-through")}>{name}</strong>
          <span className="text-sm">{service}</span>
          {handOver && <span className="text-caption font-semibold">{handOver}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 self-start">
          {/* Fixed order and at most a few: the position is a stable key, the words may repeat across locales. */}
          {tags.map((tag, n) => (
            <Badge key={n} small>
              {tag}
            </Badge>
          ))}
        </span>
      </button>
    </li>
  );
}

/** A free gap: its range and what fits in it; tapping adds a booking there. `offer` is an <OfferLine> while clients wait. */
export function GapRow({
  title,
  fits,
  action,
  offer,
  error,
  onClick,
}: {
  /** "Libre de 14 h à 16 h" */
  title: string;
  /** "Tresses ou Nattes collées", or that nothing fits. */
  fits: string;
  /** What tapping it does, said after the title. */
  action: string;
  offer?: ReactNode;
  error?: string | null;
  onClick?: () => void;
}) {
  return (
    <li>
      <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-dashed border-grip p-3.5">
        <button type="button" onClick={onClick} className="flex flex-col text-left" aria-label={`${title}. ${action}`}>
          <strong className="font-semibold">{title}</strong>
          <span className="text-sm text-muted">{fits}</span>
        </button>
        {offer}
        {error && (
          <p role="alert" className="text-sm font-semibold text-error">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

/** A blocked slot: its range and why. */
export function BlockRow({ time, title }: { time: string; title: string }) {
  return (
    <li className="flex flex-col rounded-card bg-soft px-3.5 py-3">
      <span className="text-sm text-muted">{time}</span>
      <strong className="font-semibold">{title}</strong>
    </li>
  );
}
