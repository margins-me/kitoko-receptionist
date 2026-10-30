# Book with Kitoko (MCP server)

Kitoko Receptionist exposes a remote [MCP](https://modelcontextprotocol.io) server so any AI assistant can find a
beauty pro, read her real free times and book with a PayPal deposit. The assistant never pays: it gets a PayPal
approval link that the human opens and approves. The booking is confirmed only after that.

- Endpoint: `https://<host>/api/mcp` (local: `http://localhost:3300/api/mcp`)
- Transport: Streamable HTTP, **stateless** (no session id, JSON responses, no SSE stream). `GET` and `DELETE` return
  405. CORS is open (`*`) for browser-based clients; no cookies or auth.
- Code: `packages/mcp` (server factory + HTTP handler), `apps/web/src/app/api/mcp/route.ts` (route, rate limit).
- Same services as the chat agents (`@kitoko/agent/services`): amounts always come from `packages/booking` and SQL.

## Tools

| Tool | Does | Annotations |
|---|---|---|
| `search_pros({ city?, service?, max_price?, currency?, date?, time_of_day? })` | "Shop for me". Published pros matching a city (aliases like "Milano" work), a service text ("knotless braids"), a maximum starting price in major units, a currency, a date (`YYYY-MM-DD`; without it the next 7 days) and a part of the day (`morning` before 12:00, `afternoon` 12:00–17:00, `evening` after 17:00, `any`). One option per pro: `pro_handle`, name, city, `area`, `page_url`, the matching `service` (`service_id`, name, `minutes`, `price` with default options, `from_price`), `pay_now` (deposit, booking fee, total), `balance_at_salon`, `cancellation` (one sentence, from `@kitoko/booking`), up to 4 `free_times` (`start` ISO + `local`) and `other_services`. Sorted by earliest free time, then price. With a date, pros without a free time are left out | read-only |
| `get_availability({ pro_handle, service_id, date_from, date_to })` | Up to 40 free start times over at most 14 days (ISO 8601 + local time in the pro's time zone) and the exact quote: price, deposit now, booking fee now, total now, balance at the salon, cancellation policy (English) | read-only |
| `book_with_deposit({ pro_handle, service_id, start, first_name, email?, locale? })` | `start` comes from `search_pros` `free_times` or `get_availability` `slots`. Holds the slot for 15 minutes, opens an MCP conversation (`channel = 'mcp'`, `external_id = ref`), creates the PayPal order, and returns `{ ref, start, staff, amounts, approval_url, pay_page_url, expires_at, next_step }`. When the time was just taken (another chat or agent got it first), the error (`slot_taken`, `slot_unavailable`) carries `alternatives`: up to 3 nearest free starts (`start` ISO + `local`). When PayPal fails, the hold is released | writes, open world (PayPal) |
| `booking_status({ ref })` | Status (`held`, `confirmed`, `cancelled`, `expired`, `honoured`, `no_show`), time, service, pro, paid / refunded amounts. No client data | read-only |

Services are booked in their standard version (default options), the same version `search_pros` prices.

The server instructions and the `search_pros` description tell the assistant: "When several pros match, present up to
2–3 options side by side (price, time, deposit, cancellation, area) and let the human choose before calling
book_with_deposit. Never claim reviews or ratings: Kitoko does not have them." Every call is logged to `agent_events` as
`mcp.<tool>` (the email is never stored there), so it shows on `/how-it-works?ref=<ref>`.

Limits: 20 `book_with_deposit` calls per hour per IP. The counter is in memory, per server instance, and resets on a
cold start: enough to stop a runaway agent on the demo, not a determined attacker.

## Add it to Claude

**claude.ai (web, desktop, mobile):** Settings → Connectors → Add custom connector → name `Kitoko`, URL
`https://<host>/api/mcp`. No authentication. Then enable it in a chat from the tools menu.

**Claude Code:**

```sh
claude mcp add --transport http kitoko https://<host>/api/mcp
```

**Any MCP client** that speaks Streamable HTTP works the same way (MCP Inspector: transport "Streamable HTTP", URL
above).

## Try it

> Find me knotless braids in Milan this Saturday morning, under €150.

Milan has two demo braiders: Aïcha Braids (Porta Venezia) and Anta Tresses (NoLo). `reset_demo` keeps next Saturday's
first knotless start free for both (Aïcha 09:00, Anta 10:00, when she opens), so this always has two answers.

What happens:

1. The assistant calls `search_pros({ city: "Milan", service: "knotless braids", max_price: 150, date: "<Saturday>",
   time_of_day: "morning" })`. It gets two options, earliest first:

   | | Aïcha Braids | Anta Tresses |
   |---|---|---|
   | Area | Milano, Porta Venezia | Milano, NoLo |
   | Knotless braids (standard) | €145, 375 min (from €85) | €80, 240 min |
   | Free times that morning | 09:00 (her only morning start) | 10:00, 10:30, 11:00, 11:30 |
   | Paid now (PayPal) | €30 deposit + €1.50 booking fee = €31.50 | €30 deposit + €1.50 booking fee = €31.50 |
   | At the salon | €115 | €50 |
   | Cancellation | Free cancellation up to 48 h before; after that the deposit is kept. | same |

2. **What the human sees:** the assistant shows the two options side by side like this (no reviews or ratings: Kitoko
   has none) and asks which one. Say "Anta at 10, I'm Ada".
3. It calls `book_with_deposit({ pro_handle: "anta.tresses", service_id, start: <the 10:00 free_times start>,
   first_name: "Ada" })`. It gets a ref (e.g. `K7Q2XD`) and `approval_url`, and tells the human to open it within 15
   minutes.
4. **What the human sees next:** PayPal's sandbox checkout for €31.50 (`approval_url`), or Kitoko's deposit page with
   PayPal buttons and a live status (`pay_page_url`). After approving, PayPal returns to the deposit page, which captures
   the payment and shows the booking as confirmed. In Anta's dashboard (`anta@demo.kitoko.page`) the appointment turns
   from "held" to "confirmed" live.
5. The assistant can call `booking_status({ ref })` to confirm (`status: "confirmed"`, `paid: true`).

If nobody approves within 15 minutes, the hold expires and `booking_status` says `expired`. `get_availability` still
lists more times over up to 14 days for one service. Anta has no PayPal payout e-mail (only three sandbox business
accounts exist), so her payouts stay pending.

## Check it with curl

```sh
H='-H content-type:application/json -H accept:application/json,text/event-stream'
curl -s $H http://localhost:3300/api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $H http://localhost:3300/api/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $H http://localhost:3300/api/mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_pros","arguments":{"city":"Milan","service":"knotless braids","max_price":150,"time_of_day":"morning"}}}'
```

The `Accept` header must list both `application/json` and `text/event-stream` (Streamable HTTP rule).

## Tests

- `pnpm --filter @kitoko/mcp test`: tool list, schemas and annotations, the "side by side, no reviews" wording, input
  validation, stateless HTTP `initialize`, search matching, time of day, the cancellation sentence, rate limiter.
- `pnpm --filter @kitoko/mcp test:int` (local stack running, `PAYPAL_ENV=fake` set by the setup): search filtering on the
  seed, "knotless braids in Milan next Saturday morning" (Aïcha 09:00 and Anta 10:00, then booking Anta from the search
  result), and the full round trip through the SDK client over an in-memory transport (search → availability →
  `book_with_deposit` → `approval_url` → `booking_status`). Failure cases (docs/qa.md): a web chat and an MCP agent
  holding the same time at once (one wins, the other gets `alternatives`), a past or malformed start, an unknown
  handle, and PayPal failing on the order (the hold is released). The file deletes what it created when it ends.
