import type { Metadata } from "next";
import { ArchitectureDiagram } from "@/components/how-it-works/architecture-diagram";
import { LiveTimeline } from "@/components/how-it-works/live-timeline";
import { loadTimeline } from "./load-timeline";
import { BrandMark } from "@/components/brand/brand-mark";

// Public, English only. Top: the architecture on one screen. Below: the live timeline of one booking (?ref=ABC123,
// ?b=<booking id>, or the latest web/MCP booking of the demo pro Aïcha), refreshed every 3 seconds.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "How Kitoko books, takes a PayPal deposit and updates the stylist's calendar, with a live timeline of a real booking.",
};

const GUARDRAILS = [
  ["Amounts never come from the model.", "Tools take ids and times. Prices, deposits, fees, refunds and payouts are computed by the booking engine and SQL from stored rows."],
  ["A human confirms every money move.", "Clients approve the PayPal deposit themselves (an MCP agent only gets the approval link). Refunds and payouts the stylist asks for wait for her button press."],
  ["PayPal is verified and idempotent.", "Webhooks are checked with verify-webhook-signature and stored once by event id. Every PayPal POST carries a PayPal-Request-Id. Capture is idempotent."],
  ["Every tool call is logged.", "Each call lands in agent_events with its inputs, a summary of its result and its duration: the timeline below reads them."],
] as const;

const STEPS = [
  ["Ask", "A client writes on the stylist's page, on WhatsApp, or through her own AI assistant over MCP."],
  ["Hold", "Claude finds real free times and holds one: 15 minutes on the web, 30 on WhatsApp and MCP, topped up once when the pay page opens."],
  ["Pay", "PayPal Orders v2: the client approves the deposit; the capture confirms the booking."],
  ["Run the day", "The stylist's Bryntum calendar updates live. Cancellations refund per policy, done bookings pay her out."],
] as const;

type Search = { ref?: string | string[]; b?: string | string[] };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function HowItWorks({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const ref = first(params.ref);
  const b = first(params.b);
  const initial = await loadTimeline({ ref, b });
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : b ? `?b=${encodeURIComponent(b)}` : "";

  return (
    <div className="mx-auto flex min-h-dvh max-w-page flex-col px-4 pt-2 pb-[max(32px,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4">
      <header className="sticky top-0 z-20 -mx-4 flex min-h-11 items-center justify-between gap-3 bg-stone/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        <BrandMark size="lg" />
        <a href="/aicha.braids" className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-stone-line bg-surface px-4 text-ui font-semibold whitespace-nowrap text-ink no-underline hover:border-ink">
          Try a booking
        </a>
      </header>

      <main className="flex flex-1 flex-col">
        <section aria-labelledby="hiw-title" className="pt-10 pb-8 sm:pt-12">
          <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-caption font-medium text-body">
            <span aria-hidden className="size-2 rounded-full bg-honey" />
            Claude + PayPal, under the hood
          </p>
          <h1 id="hiw-title" className="mt-5 text-[36px] leading-[1.02] font-bold tracking-hero sm:text-[56px]">
            How it works
          </h1>
          <p className="mt-4 max-w-[34em] text-lead leading-snug text-body">
            One AI front desk for an independent stylist, on every channel. It books real times, takes the deposit with PayPal, applies
            her cancellation policy and keeps her calendar live.
          </p>
        </section>

        <section aria-label="Architecture" className="grid gap-6 rounded-card bg-surface p-4 sm:p-8 lg:grid-cols-[minmax(0,400px)_1fr] lg:gap-10">
          <div className="mx-auto w-full max-w-[420px] lg:max-w-[400px]">
            <ArchitectureDiagram />
          </div>
          <div className="flex flex-col gap-6">
            <ol className="grid gap-3 sm:grid-cols-2">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="rounded-[16px] bg-stone p-4">
                  <p className="text-caption font-semibold text-muted tabular-nums">0{i + 1}</p>
                  <p className="mt-1 text-ui font-bold">{title}</p>
                  <p className="mt-1 text-caption leading-snug text-body">{text}</p>
                </li>
              ))}
            </ol>
            <div>
              <h2 className="text-lead font-bold">Guardrails</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {GUARDRAILS.map(([title, text]) => (
                  <li key={title} className="flex gap-3">
                    <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-honey" />
                    <p className="text-ui leading-snug text-body">
                      <span className="font-semibold text-ink">{title}</span> {text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="live-title" className="pt-12">
          <h2 id="live-title" className="text-[26px] leading-tight font-bold tracking-tight sm:text-[32px]">
            Live: one booking, step by step
          </h2>
          <p className="mt-2 mb-5 max-w-[40em] text-ui leading-relaxed text-body">
            Every agent tool call, PayPal event and booking change, in order, with how long each call took. Open{" "}
            <code className="rounded bg-surface px-1 py-0.5 text-caption">/how-it-works?ref=ABC123</code> with the reference
            from your confirmation to follow your own booking.
          </p>
          <LiveTimeline initial={initial} query={query} />
        </section>
      </main>
    </div>
  );
}
