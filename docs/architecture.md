# Architecture

Kitoko Receptionist is an AI receptionist for beauty pros. It takes the booking conversation (web chat, WhatsApp, or an
outside AI agent through MCP), holds a slot, collects the deposit with PayPal, applies the pro's cancellation policy
(refund or keep), pays the pro out through PayPal, and lets the pro run her day in plain language. The pro sees
everything live in a Bryntum calendar.

Everything runs in **PayPal sandbox**. Money is integer cents everywhere. The model never chooses an amount: every price,
deposit, fee, refund and payout is computed by `packages/booking` or by SQL from stored rows.

## Repo layout

```
apps/web               One Next.js 16 app (App Router, next-intl, Tailwind 4)
  src/app/[locale]/              landing (demo pros), /[handle] pro page + chat, /pay/[id] deposit page
  src/app/dashboard/             pro dashboard: login, Bryntum Scheduler, pro assistant, deposits
  src/app/how-it-works/          live timeline of agent tool calls + PayPal events for one booking
  src/app/api/chat/              web chat (client and pro), NDJSON stream + polling
  src/app/api/paypal/webhook/    PayPal webhooks (verified with verify-webhook-signature)
  src/app/api/whatsapp/webhook/  WhatsApp Cloud API inbound (GET verify, POST messages, X-Hub-Signature-256)
  src/app/api/mcp/               "Book with Kitoko" remote MCP server (stateless Streamable HTTP)
packages/booking       ported from Kitoko: slots, quote, deposit, booking fee, cancellation policy, rule texts
packages/db            Supabase clients + typed wrappers around tables and RPCs (server-only)
packages/paypal        PayPal REST client: OAuth, Orders v2, refunds, Payouts, Invoicing v2, Reporting, webhooks
packages/agent         Claude agents (client + pro), tool definitions, prompts, guardrails, and the services layer
packages/channels      Channel adapters: web (conversation rows) and WhatsApp (ported Cloud API transport)
packages/mcp           MCP server factory (tools wrap the same services as the agents)
packages/i18n, themes, ui, config   ported from Kitoko (ui keeps the pro page components)
supabase/              one schema migration per area + seed with 4 fictional pros + pgTAP tests
```

Workspace packages keep the `@kitoko/*` scope so ported imports work unchanged.

## Local ports

- Web app: `http://localhost:3300`
- Supabase local stack: API 54531, DB 54532, Studio 54533, Mailpit 54534 (project id `kitoko-receptionist`), so it runs
  beside Kitoko's stack (544xx).

## Environment variables

All read through lazy getters in `apps/web/src/lib/env.ts` (server-only). See `.env.example`.

| Variable | Use |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server clients |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client (dashboard Realtime + auth) |
| `SITE_URL` | Public base URL: PayPal return/cancel URLs and pay links for WhatsApp, MCP, webhooks and the cron. The web chat, the deposit page and the dashboard use the request's origin instead when it is trusted (local hosts, SITE_URL's host, this Vercel deployment's hosts: `apps/web/src/lib/origin.ts`), so a dev server on another port keeps the buyer on itself |
| `ANTHROPIC_API_KEY` | Claude. Without it, `AGENT_FAKE=1` uses a scripted model (local dev and tests only) |
| `AGENT_MODEL_CLIENT` | Client receptionist (web chat, WhatsApp). Default `claude-haiku-5-5`, effort medium |
| `AGENT_MODEL_PRO` | Pro assistant. Default `AGENT_MODEL`, else `claude-sonnet-5-5` |
| `AGENT_MODEL` | Default `claude-sonnet-5-5` |
| `PAYPAL_ENV` | `sandbox` (default). `fake` = in-process fake PayPal for local dev and tests |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Platform sandbox REST app |
| `PAYPAL_WEBHOOK_ID` | Id of the webhook registered on the sandbox app (needed to verify signatures) |
| `WHATSAPP_TRANSPORT` | `log` (default, prints messages) or `cloud` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION` | Cloud API sending |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Inbound webhook verification |
| `WHATSAPP_DEMO_PRO` | Handle of the pro a WhatsApp client talks to (one test number serves one pro) |
| `CRON_SECRET` | Bearer token Vercel cron sends to `GET /api/cron/keepalive` (daily: keeps Supabase awake, sweeps pending refunds and payouts) |

## Data model (Postgres, `supabase/migrations`)

Kept from Kitoko (trimmed): `pros`, `categories`, `services`, `day_overrides`, `blocks`, `clients`, `bookings`.
New: `staff`, `service_staff`, `payments`, `refunds`, `payouts`, `paypal_events`, `conversations`,
`conversation_messages`, `agent_events`, `pending_actions`.

- **pros**: `id` = `auth.users.id`. Adds `currency` (`EUR`|`GBP`), `city`, `paypal_email`. Keeps the page appearance
  columns so the Kitoko pro page renders unchanged. Photos are app paths (`/photos/...`) or absolute URLs.
- **staff** (`id, pro_id, name, color, position`) and **service_staff** (`pro_id, service_id, staff_id`). Every pro has at
  least one staff row; a solo pro has exactly one. Bryntum resources = staff.
- **bookings**: adds `ref` (6 chars, unique, shown to clients), `staff_id` (NOT NULL), `currency`, `fee_cents`, `source`
  (`web`|`whatsapp`|`mcp`|`manual`), `conversation_id`, `displaced_at` (set by a sick-day block until rebooked or
  cancelled). Status: `held` → `confirmed` → `honoured` | `no_show` | `cancelled`; `held` → `expired`.
  Overlap rule: `exclude using gist (staff_id with =, during with &&) where status in ('held','confirmed','honoured')`.
- **blocks**: adds nullable `staff_id` (null = whole business).
- **clients**: `first_name` required; `phone_e164` and `email` optional (PayPal fills the email).
- **payments**: `booking_id, kind ('deposit'|'balance'), paypal_order_id unique, capture_id, deposit_cents, fee_cents,
  amount_cents, currency, refunded_cents, status ('created'|'approved'|'captured'|'refunded'|'denied'), payer jsonb`.
  Seed rows use capture ids starting with `SEED-`: the PayPal client never calls PayPal for those.
- **refunds**: `payment_id, amount_cents, reason, status ('pending'|'succeeded'|'failed'), paypal_refund_id`.
- **payouts**: `booking_id, pro_id, amount_cents, fee_cents, currency, status ('pending'|'sent'|'succeeded'|'failed'|
  'unclaimed'), payout_batch_id, payout_item_id`.
- **paypal_events**: `event_id` primary key (idempotency), `type, resource_id, payload, verified, processed_at`.
- **conversations**: `kind ('client'|'pro'), channel ('web'|'whatsapp'|'mcp'), external_id, pro_id, client_id, locale,
  token` (unguessable, lets a web chat be reopened). Unique `(channel, external_id, pro_id, kind)`.
- **conversation_messages**: `conversation_id, role ('user'|'assistant'), content jsonb` (Anthropic content blocks),
  `visible boolean` (system events injected for the agent are not shown), `created_at`.
- **agent_events**: one row per tool call/result, model turn or error, with `conversation_id`, `booking_id`, `name`,
  `input`, `output`, `ms`. Feeds the "How it works" page.
- **pending_actions**: refunds, payouts and invoices the pro asked her assistant for. `status ('pending'|'confirmed'|
  'cancelled')`. Only a human button (dashboard) or a WhatsApp button reply with the action id confirms one, never the
  model.

### SQL functions (security definer, service role unless noted)

| Function | Does |
|---|---|
| `create_hold(pro, service, staff?, start, minutes, selection, policy, price, deposit, fee, source, conversation?, locale)` | Picks an eligible free staff when `staff` is null, inserts a `held` booking for 15 min on the web, 30 min on WhatsApp and MCP (`private.hold_ttl(source)`, `20261027001000_hold_by_channel.sql`), returns `(id, ref, staff_id, hold_expires_at)`. Raises `KT001` blocked, `23P01` taken, `KT005` too many live holds in the conversation (max 3) |
| `release_hold(booking)` | Expires a hold the agent replaced |
| `confirm_booking(booking, first_name, phone?, email?, locale?)` | Upserts the client, `held` → `confirmed`; re-takes a lapsed hold if still free |
| `reschedule_booking(booking, start, by)` | Moves a confirmed booking, keeps its staff if free, else another eligible one; clears `displaced_at`; the deposit carries over |
| `cancel_booking(booking, by ('client'|'pro'|'system'), reason)` | Computes the refund from the policy snapshot and inserts a pending `refunds` row. Returns `(refund_cents, kept_cents)` |
| `preview_cancel(booking, by)` | Same arithmetic as `cancel_booking`, read-only: `(refund_cents, kept_cents, fee_kept_cents)`. The client agent shows it before cancelling (`20261027000900_cancel_preview.sql`) |
| `refresh_hold_on_open(booking)` | The deposit page's first opening: a held booking's hold runs at least 15 more minutes from now, never shortened, once per booking (`bookings.hold_refreshed_at`) |
| `mark_honoured(booking)`, `mark_no_show(booking)` | Pro (auth.uid) or service role. Insert the pending payout |
| `block_time(pro, staff?, during, label)` | Inserts the block and sets `displaced_at` on the confirmed bookings it overlaps. Returns their ids |
| `busy_intervals(pro, staff, from, to)` | Bookings + blocks, used for slots |
| `paypal_prepare(booking, order_id)` | Inserts the `created` payment; amounts come from the booking row |
| `paypal_capture_completed(order_id, capture_id, amount, currency, payer)` | Idempotent. Checks amount and currency, confirms the booking. If the slot was lost meanwhile: booking `expired` + full refund queued |
| `paypal_capture_denied(order_id)` | Payment `denied`, booking `held` → `expired` (a PENDING capture PayPal refused in the end) |
| `paypal_capture_declined(order_id)` | A 422 INSTRUMENT_DECLINED capture: counts it (`payments.capture_declines`); booking stays `held`, the buyer approves again and the next capture sends `PayPal-Request-Id: capture-{order}-{n}` |
| `reset_demo(pro)` | **Reset demo before filming** (`select reset_demo(id) from pros`, or the dashboard button): a rehearsed sick-day cascade offers displaced clients the nearest free times, which can take next Saturday morning. Restores the pro's seeded week (demo button), every booking inside her opening hours, next Saturday morning free for knotless, the 3 cascade bookings on today + 3 (today + 4 when today + 3 is that Saturday). Rules: `supabase/migrations/20261027000700_demo_within_hours.sql` |

Cron: `expire-holds` every minute.

### Money rules (from Kitoko's locked decisions, reused as is)

- Deposit: the service's or pro's deposit rule (`packages/booking` `depositDue`/`checkoutAmounts`).
- Booking fee: Kitoko's tiered fee on the amount paid online, paid by the client on top of the deposit
  (`bookingFee`). Same numbers in GBP for the London pro.
- Client cancels inside the free window: deposit refunded, booking fee kept. Late cancellation or no-show: the policy
  tiers decide what is kept (`cancellationOutcome` in TS, `private.kept_service_cents` in SQL; a test keeps them equal).
- Pro cancels, or the client declines a sick-day move: everything refunded, booking fee included.
- Payout to the pro (Payouts API, to `pros.paypal_email`) when she marks the booking done or no-show, or after a late
  cancellation: `deposit_cents − refunded deposit part`. Kitoko keeps the booking fee.
- The balance (price − deposit) is paid at the salon, or by a PayPal invoice the pro asks her assistant to send.

## Flows

**Client booking (any channel).** Ask → `list_services` → `get_availability` → `hold_slot` (15 min on the web, 30 on WhatsApp and MCP; the deposit page's first opening tops it up to 15 min from then) →
`create_deposit_link` (PayPal order, returns `/pay/{booking}` and the PayPal approval URL) → buyer approves → capture
(on return from PayPal, and by webhook `PAYMENT.CAPTURE.COMPLETED` as a backstop) → booking confirmed → a system event
is appended to the conversation and the agent writes the confirmation in the client's language on the same channel →
the dashboard calendar updates through Supabase Realtime.

**Proactive messages.** Server events (payment captured, sick-day displacement, drag in the calendar) are appended to
the conversation as hidden `user` messages (`[event] ...`). The agent then runs and its reply is delivered on the
conversation's channel. A web chat shows new messages by polling.

**Sick-day cascade.** The pro blocks a day (calendar button or "I'm sick Friday") → `block_time` marks the affected
bookings displaced → for each one the agent messages the client with real free slots → the client picks one
(`reschedule_booking`, deposit carried over) or declines (`cancel_booking` by `pro` → full refund through PayPal) → the
calendar rearranges live.

**Drag in the calendar.** On drag start the calendar fetches the booking's valid new starts (`moveTargets`) and
highlights them; a drop snaps to the nearest one (else "Pick a highlighted time"). The booking is shown as "proposed" →
the agent asks the client → yes: `reschedule_booking` to exactly the proposed start (by `pro`, not counted against her
moves); no: `decline_proposed_move` records `reschedule_declined`, the booking stays and the calendar drops the ghost
(pro may cancel, which refunds in full).

**Pro assistant.** Dashboard chat and WhatsApp from the pro's number. Money actions return a pending action rendered as a
confirm button; a confirmed invoice shows its PayPal id and the payer-view link in the receipt. Earnings for a range
count the bookings whose APPOINTMENT falls in it (deposits captured whenever, seeded `SEED-` captures included, their
refunds, payouts and fees); PayPal Reporting rows come as a separate, best-effort part (sandbox reporting lags by hours).
After a sick-day block the clients decide: a picked time moves the booking, a refund goes out automatically through
PayPal (no Confirm button: the block already decided it).

**Client cancellation.** `cancel_booking` without `confirm` only previews (`preview_cancel`): the agent states the
refund and what is kept and asks. `confirm: true` cancels only when that exact outcome was previewed in an earlier run of
the conversation, under 30 minutes ago, and this run answers the client's own message. Displaced and held bookings are
cancelled at once.

**MCP.** `search_pros`, `get_availability`, `book_with_deposit` (returns the PayPal approval URL; a human approves,
the agent never pays alone), `booking_status`.

## Guardrails

- Every fact the agents state comes from a tool result. Prompts forbid inventing prices, slots or policies.
- Tools take ids, never amounts. Amounts come from `packages/booking` + SQL.
- Client tools only see bookings of their own conversation (or WhatsApp number). They cannot refund outside the policy.
- Refunds and payouts the pro starts need her button press. The model cannot confirm a pending action.
- Every PayPal POST sends `PayPal-Request-Id` (idempotency). Webhooks are verified and deduplicated by `event_id`.
- Every tool call is logged to `agent_events`.

## Services layer (`@kitoko/agent/services`)

One place where money and bookings move. Agents' tools, the MCP server, webhooks, the deposit page and the dashboard
all call these, never PayPal or SQL directly. Each takes a `ServicesCtx` (`{ db, paypal, deliver, now, siteUrl,
log }`, built once per request by `createServicesCtx()` from env) and returns a `Result`.

| Service | Used by |
|---|---|
| `findSlots({ proId, serviceId, selection, from, to })` → slots `{ start, end, staffIds }` | client agent, MCP, dashboard |
| `quoteService({ proId, serviceId, selection })` → price, minutes, deposit, fee, currency, policy summary | client agent, MCP |
| `holdSlot({ proId, serviceId, selection, start, source, conversationId, locale })` → booking `{ id, ref, start, end, staff, amounts, holdExpiresAt }` | client agent, MCP |
| `createDepositLink({ bookingId, firstName?, phone?, email? })` → `{ payUrl, approveUrl, orderId, amountCents, currency }` | client agent, MCP, deposit page |
| `capturePayment({ orderId })` → `{ bookingId, status }` (idempotent) | deposit page return, PayPal webhook |
| `cancelBooking({ bookingId, by, reason })` → `{ refundCents, keptCents, refund }` (runs the PayPal refund) | client agent, pro actions, cascade |
| `previewCancellation({ bookingId, by })` → what `cancelBooking` would refund and keep, nothing changes | client agent |
| `rescheduleBooking({ bookingId, start, by })` | client agent, drag, cascade |
| `markDone({ bookingId, outcome })` → payout (runs the PayPal payout) | dashboard button, pro actions |
| `blockTime({ proId, staffId?, from, to, label })` → `{ blockId, displaced }` + notifies each displaced client | dashboard, pro assistant |
| `moveTargets({ bookingId, from, to })` → every valid new start (same service and length, her rules, free) | Bryntum drag |
| `proposeMove({ bookingId, start })` → notifies the client, waits for her answer; `declineProposal({ bookingId })` records her no | Bryntum drag, client agent |
| `openDepositPage({ bookingId })` → the hold's one top-up when the deposit page opens | deposit page |
| `requestAction({ proId, kind, bookingId, payload })` / `decideAction({ actionId, decision })` | pro assistant / buttons |
| `sendBalanceInvoice({ bookingId })` → PayPal invoice | via a confirmed pending action |
| `earnings({ proId, from, to })` → totals for the appointments in [from, to) + PayPal Reporting rows (best effort) | pro assistant, dashboard money |
| `notifyConversation({ conversationId, event })` → runs the client agent on `[event] …` and delivers the reply | services above, webhooks |
| `handlePayPalWebhook({ headers, body })` → `{ status, body }`: 400 bad signature, 503 verify API down, 200 duplicate / ignored / processed, 500 (event forgotten so PayPal's retry runs) when dispatch fails | `/api/paypal/webhook` |
| `handleMessage({ channel, externalId, proHandle, kind, text, buttonId? })` → event stream | `/api/chat`, WhatsApp webhook |

## HTTP routes (apps/web)

| Route | Contract |
|---|---|
| `POST /api/chat` | Body `{ handle, token?, text }` (client) or `{ kind: 'pro', text }` with the pro's session cookie. Response: NDJSON stream of `{type:'token', token}` (new conversation), `{type:'text', delta}`, `{type:'tool', name, status}`, `{type:'done'}` |
| `GET /api/chat?token=…&after=…` | Visible messages after a timestamp (web chat polling for proactive messages) |
| `POST /api/paypal/webhook` | `handlePayPalWebhook`: verify, dedupe by `event_id`, dispatch to services |
| `GET/POST /api/whatsapp/webhook` | Meta challenge / inbound messages (signature checked) |
| `POST /api/mcp` | MCP Streamable HTTP, stateless |
| `/[locale]/pay/[id]` | Deposit page: summary, PayPal buttons (JS SDK v6) or approve link, live status |
| `/[locale]/pay/[id]/return` | PayPal return URL: captures, then redirects to the page |
| `/pay/fake-approve` | Dev only (`PAYPAL_ENV=fake`): approves the fake order and redirects to the return URL |
