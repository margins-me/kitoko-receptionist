import type { Metadata } from "next";
import { headers } from "next/headers";
import { BrandMark } from "@/components/brand/brand-mark";
import { originFromHeaders, trustedOrigin } from "@/lib/origin";

// Where a browser lands when it opens /api/mcp: what the "Book with Kitoko" MCP server is and how to add it in Claude.

export const metadata: Metadata = {
  title: "Book with Kitoko · MCP server",
  description: "Add the Book with Kitoko MCP server to Claude: find independent stylists, see real free times and book with a PayPal deposit.",
  robots: { index: false },
};

const TOOLS = [
  ["search_pros", "Stylists offering a style on a date, with price, free times, deposit and cancellation rule."],
  ["get_availability", "Free times for one stylist and service."],
  ["book_with_deposit", "Holds the chosen slot for 30 minutes and returns the PayPal approval link."],
  ["booking_status", "Held, paid or expired."],
] as const;

export default async function McpPage() {
  const origin = trustedOrigin(originFromHeaders(await headers()), process.env) ?? process.env.SITE_URL ?? "";
  const endpoint = `${origin}/api/mcp`;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[720px] flex-col px-4 pt-2 pb-[max(32px,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4">
      <header className="sticky top-0 z-20 -mx-4 flex min-h-11 items-center justify-between gap-3 bg-stone/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        <BrandMark size="lg" />
        <a
          href="/how-it-works"
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-stone-line bg-surface px-4 text-ui font-semibold text-ink no-underline hover:border-ink"
        >
          How it works
        </a>
      </header>

      <main className="fade-up pt-10 sm:pt-12">
        <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-caption font-medium text-body">
          <span aria-hidden className="size-2 rounded-full bg-honey" />
          MCP server · PayPal sandbox
        </p>
        <h1 className="mt-5 text-[36px] leading-[1.02] font-bold tracking-hero sm:text-[52px]">Book with Kitoko</h1>
        <p className="mt-4 text-lead leading-snug text-body">
          Your AI assistant can find independent nail techs, braiders and lash artists, compare their real prices and free times, and book one. You
          approve the PayPal deposit yourself.
        </p>

        <section aria-labelledby="connect" className="mt-10">
          <h2 id="connect" className="text-[22px] leading-tight font-bold tracking-tight">
            Connect it in Claude
          </h2>
          <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-ui text-body">
            <li>
              Settings → Connectors → <b className="text-ink">Add custom connector</b>.
            </li>
            <li>
              Paste this URL (no login needed):
              <code className="mt-2 block rounded-lg bg-surface px-3 py-2 font-mono text-caption break-all text-ink">{endpoint}</code>
            </li>
            <li>
              Ask: <i>&ldquo;Find me knotless braids in Milan this Saturday morning, under €150.&rdquo;</i>
            </li>
          </ol>
          <p className="mt-5 rounded-card bg-surface p-4 text-ui text-body">
            Claude shows the options side by side, holds the one you pick and gives you a PayPal link. Pay with the sandbox buyer from the testing
            instructions: the booking then appears in the stylist&rsquo;s calendar.
          </p>
        </section>

        <section aria-labelledby="tools" className="mt-10">
          <h2 id="tools" className="text-[22px] leading-tight font-bold tracking-tight">
            Tools
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {TOOLS.map(([name, body]) => (
              <li key={name} className="rounded-card border border-stone-line p-4">
                <code className="font-mono text-ui font-semibold text-ink">{name}</code>
                <p className="mt-1 text-ui text-muted">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-caption text-muted">
            Streamable HTTP, stateless: MCP clients send JSON-RPC with POST to this URL. Amounts come from the booking engine, never from the model.{" "}
            <a href="/how-it-works" className="text-ink">
              See every tool call live
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
