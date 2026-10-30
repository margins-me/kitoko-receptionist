# Kitoko: AI Front Desk

**An AI front desk for independent nail techs, braiders and lash artists. It books clients in the chat in minutes, takes the deposit with PayPal and handles the sick day. No deposit, no booking.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (Oct–Nov 2026). Everything runs in the **PayPal sandbox**.

- **Live demo:** https://demo.kitoko.page
- **Stylist dashboard:** https://demo.kitoko.page/dashboard (demo logins below)
- **Every tool call and PayPal event, live:** https://demo.kitoko.page/how-it-works
- **MCP server for AI assistants:** `https://demo.kitoko.page/api/mcp`

---

## The problem

For most independent stylists, booking happens in Instagram DMs and WhatsApp: "Are you free Saturday? How much?" A booking takes days of back-and-forth, the deposit is chased by hand, and a slot often goes in the calendar before the deposit arrives. When it never does, the client doesn't come either, and the stylist loses a day of income.

## What it does

| | |
|---|---|
| **Books in the chat, in the client's language** | It already knows her prices, hours and rules, so it offers the next free time right away. Options come as tap-to-reply buttons. |
| **Holds the slot and takes a PayPal deposit** | 15-minute hold, PayPal JS SDK v6 buttons (PayPal and Pay Later). The booking exists only once PayPal confirms the payment, and the confirmation arrives in the same chat. |
| **Same front desk on WhatsApp** | WhatsApp Cloud API channel (signed webhook, reply buttons, 30-minute holds). No Meta number is connected for the demo: the WhatsApp simulator at `/<handle>/whatsapp` drives the same channel. |
| **Applies her cancellation policy** | Inside the free window the deposit is refunded through PayPal; late cancellations keep it. Amounts are computed by the database, never by the model. |
| **Reorganises a sick day in one click** | She blocks a day; the front desk contacts each affected client, offers real new times, moves those who accept and refunds the others through PayPal. |
| **Live calendar (Bryntum Scheduler)** | Deposit status on every booking (held with a countdown, paid, refunded, balance due, waiting for client), live updates, drag a booking to ask the client to move. |
| **Her assistant, in plain language** | "What did I make this week?", "Who hasn't paid?", "Refund Sarah", "Send Fatou an invoice for the balance". Money only moves after she taps confirm. |
| **Money table (AG Grid)** | Every PayPal payment, refund and payout with its PayPal id, a live net total and CSV export. "Show me this week's refunds" filters it. |
| **Pays her out** | PayPal Payouts once the appointment is done. |
| **Bookable by other AI agents** | "Book with Kitoko" MCP server: any MCP client compares stylists, holds a slot and hands the human a PayPal approval link. |

## Try it

1. Open https://demo.kitoko.page and pick **Aïcha Braids (Milan)**.
2. Tap **Chat to book** and write in any language, for example *"Ciao! Knotless braids sabato mattina?"* or *"Hi, any time Saturday for knotless braids?"*
3. Pick a time, open the PayPal link, enter a first name and pay with the **sandbox buyer**:
   - email `kitoko-buyer-it@personal.example.com`
   - password `Kitoko-Buyer-2026!`
   - (UK, GBP: `kitoko-buyer-uk@personal.example.com`, same password)
4. Prefer WhatsApp? The **WhatsApp** button on her page opens the simulator.
5. See the booking from her side at **/dashboard** (the "Use" buttons fill these in):
   - `aicha@demo.kitoko.page` · `kitoko-demo-2026` (Milan, EUR)
   - `anta@demo.kitoko.page` · `kitoko-demo-2026` (Milan, EUR)
   - `nala@demo.kitoko.page` · `kitoko-demo-2026` (Lyon, EUR, 2 staff)
   - `kemi@demo.kitoko.page` · `kitoko-demo-2026` (London, GBP)
6. In the dashboard: drag a booking to a highlighted time, press **Block time** on a day with bookings (the sick-day cascade), or ask the assistant *"What did I make this week?"* or *"Show me this week's refunds"*.
7. **Reset demo** (top bar) restores her week, at most once every 5 minutes since the logins are shared. The demo also resets itself every night.
8. **MCP:** add `https://demo.kitoko.page/api/mcp` as a custom connector in your AI assistant and ask *"Find me knotless braids in Milan this Saturday morning, under €150"*. See [docs/mcp.md](docs/mcp.md).

All stylists, clients and photos are fictional demo data. Photos are from Unsplash.

## How it's built

```
Client (web chat · WhatsApp · MCP) ─┐   (WhatsApp: simulator in the demo)
                                    ├─► Claude agent (tools) ─► services ─► Postgres (Supabase)
Stylist (dashboard · assistant) ────┘                              │             │
                                                                   ▼             ▼
                                                     PayPal (sandbox)     Realtime ─► Bryntum calendar
```

- **AI:** Claude through the Anthropic API. **Claude Haiku 5.5** is the client-facing front desk (fast, multilingual); **Claude Sonnet 5.5** is her assistant and writes the sick-day messages. Tool use with prompt caching; every fact the agent states comes from a tool result.
- **PayPal:**
  - **Orders v2** + **JS SDK v6** for deposits, with **Pay Later** where eligible
  - **Webhooks** verified with `verify-webhook-signature` and processed once per `event_id`
  - **Refunds** applied by the cancellation policy
  - **Payouts** to the stylist
  - **Invoicing v2** for the balance
  - **Transaction Search** (Reporting) for earnings
  - **PayPal Agent Toolkit** for the assistant's read-only PayPal tools: transactions, invoices, refunds, disputes
  - Every POST carries a `PayPal-Request-Id`.
- **Money rules live in the database.** Tools pass booking ids, never amounts. `refund = paid − already refunded − kept`, where *kept* comes from her cancellation tiers. An exclusion constraint prevents double booking across chat and MCP. Holds expire through `pg_cron`.
- **Stack:** Next.js 16 (App Router) on Vercel, Supabase (Postgres, Realtime, Auth, pg_cron), TypeScript, Tailwind 4, next-intl, Bryntum Scheduler, AG Grid Community, the TypeScript MCP SDK. pnpm + Turborepo monorepo.

More detail: [docs/architecture.md](docs/architecture.md) · failure cases and their tests: [docs/qa.md](docs/qa.md).

```
apps/web            Next.js app: stylist page + chat, deposit page, /dashboard, /how-it-works, /api/*
packages/agent      Claude agents, tools, prompts, and the services layer (all money moves)
packages/paypal     PayPal REST client (Orders, Refunds, Payouts, Invoicing, Reporting, Webhooks) + fake
packages/booking    Booking engine: slots, quotes, deposits, cancellation policy, time zones
packages/db         Typed Supabase access
packages/mcp        "Book with Kitoko" MCP server
packages/channels   WhatsApp Cloud API adapter (the demo drives it from a simulator page)
packages/ui, themes, i18n, config
supabase/           Schema migrations, seed (fictional stylists), pgTAP tests
```

## Run it locally

Requirements: Node 24, pnpm 10, Docker (for the local Supabase stack), the Supabase CLI.

```bash
pnpm install
pnpm db:start            # local Supabase on ports 54530–54539, seeded with the demo stylists
cp .env.example apps/web/.env.local   # fill in the keys printed by `supabase status`
pnpm dev                 # http://localhost:3300
```

Without API keys you can still run it: `AGENT_FAKE=1` uses a scripted model and `PAYPAL_ENV=fake` an in-process fake PayPal. With your own keys, set `ANTHROPIC_API_KEY` and a PayPal sandbox app's `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.

Checks:

```bash
pnpm check        # guard, lint, typecheck, unit tests
pnpm test:int     # integration tests against the local stack
pnpm db:test      # pgTAP database tests
```

## Built during the hackathon

Created in October 2026 during the submission period. The booking engine and the UI kit come from **Kitoko** ([kitoko.page](https://kitoko.page)), our own booking product, started on Oct 18, 2026. Everything specific to this entry was built for the hackathon: the PayPal integration, the AI agents, WhatsApp, the MCP server, the Bryntum calendar, the money table and the sick-day cascade.

## Production note

This is a sandbox design: the platform collects the deposit and pays the stylist out. In live mode that needs PayPal's marketplace (multiparty) approval.

## License

[AGPL-3.0](LICENSE), with an additional permission for linking with Bryntum's components ([NOTICE](NOTICE)). Bryntum is not part of this repository and is installed from npm under its own license.
