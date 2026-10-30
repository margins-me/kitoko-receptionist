import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { alternativesNear, createDepositLink, findSlots, holdSlot, quoteService, TAKEN_ERRORS } from "@kitoko/agent/services";
import type { ServicesCtx } from "@kitoko/agent/services";
import { addDays, localDate } from "@kitoko/booking";
import type { Locale } from "@kitoko/booking";
import {
  getBookingByRef,
  getOrCreateConversation,
  getPro,
  getProByHandle,
  getService,
  listPros,
  logAgentEvent,
  releaseHold,
} from "@kitoko/db";
import type { Json, Pro } from "@kitoko/db";
import {
  cancellationRule,
  cityMatches,
  dayCount,
  inTimeOfDay,
  LOCALES,
  localRange,
  localTime,
  minutesRange,
  money,
  serviceMatches,
  TIMES_OF_DAY,
  tradesOf,
} from "./format";

/** Builds the services context for one tool call (createServicesCtx() in the app, a test double in tests). */
export type CtxFactory = () => ServicesCtx | Promise<ServicesCtx>;

export type KitokoMcpOptions = {
  /**
   * Asked before every hold. False → the call fails with `rate_limited` and nothing is held. The route allows 20 holds
   * per hour per IP.
   */
  allowHold?: () => boolean;
};

const CHOOSE =
  "When several pros match, present up to 2–3 options side by side (price, time, deposit, cancellation, area) and let the human choose before calling book_with_deposit.";
const NO_REVIEWS = "Never claim reviews or ratings: Kitoko does not have them.";

export const SERVER_INSTRUCTIONS = `Book with Kitoko: find independent beauty pros (braids, nails, lashes, hair) in Milan, Lyon and London, see their real free times and book an appointment with a PayPal deposit.

Flow:
1. search_pros: by city, service ("knotless braids"), max price, and a date and time of day ("this Saturday morning"). Each result is one pro with the matching service, its price, what is paid now (deposit + booking fee), the cancellation rule, the area and up to 4 free start times that day, sorted by earliest free time then price.
2. ${CHOOSE}
3. Optionally get_availability: more free times for one service over a few days, with the same quote.
4. book_with_deposit: holds the chosen start time (a start value from search_pros or get_availability) until expires_at (30 minutes) and returns approval_url. Give approval_url to the human: they approve the PayPal payment themselves. You cannot pay on their behalf, and the booking is confirmed only after they approve.
5. booking_status: check the booking with its ref (held → confirmed once paid; expired if not paid by expires_at).

Rules: every amount comes from Kitoko (never compute or promise a price yourself). ${NO_REVIEWS} Times are ISO 8601; each slot also has its local time in the pro's time zone. The rest of the price (balance) is paid at the salon. Only ask the human for a first name (and optionally an email for the receipt).`;

const NEXT_STEP =
  "Send the human to approval_url to approve the PayPal payment. The booking is confirmed only after they approve; you cannot pay on their behalf.";

const HOLD_ERRORS: Record<string, string> = {
  slot_taken: "That time was just taken. Call get_availability again and pick another start time.",
  slot_blocked: "The pro is not available at that time. Call get_availability again and pick another start time.",
  slot_unavailable: "That start time is not free (any more). Call get_availability again and use one of its start values.",
  invalid_start: "start must be an ISO 8601 date-time returned by get_availability.",
  pro_not_found: "Unknown pro.",
  service_not_found: "Unknown service.",
  too_many_holds: "Too many live holds for this booking. Wait for one to expire or be paid.",
  staff_not_eligible: "Nobody at this salon can do that service at that time. Pick another start time.",
  not_found: "Unknown pro or service.",
};

const STATUS_TEXT: Record<string, string> = {
  held: "Held until expires_at, waiting for the human to approve the PayPal deposit.",
  confirmed: "Confirmed: the deposit is paid.",
  honoured: "Done: the appointment took place.",
  no_show: "Marked as a no-show.",
  cancelled: "Cancelled.",
  expired: "Expired: the deposit was not paid in time, the slot was released.",
};

// ---------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------

/** What a tool produced, plus what agent_events records (a short summary, ids for the "How it works" timeline). */
type Outcome =
  | { ok: true; value: Record<string, unknown>; summary: Json; link?: Link }
  | { ok: false; error: string; message: string; link?: Link; extra?: Record<string, unknown> };

type Link = { proId?: string | null; bookingId?: string | null; conversationId?: string | null };

const fail = (error: string, message: string, link?: Link, extra?: Record<string, unknown>): Outcome => ({
  ok: false,
  error,
  message,
  ...(link ? { link } : {}),
  ...(extra ? { extra } : {}),
});

function toResult(outcome: Outcome): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: outcome.error, message: outcome.message, ...outcome.extra }) }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(outcome.value) }], structuredContent: outcome.value };
}

/** Logged inputs: the email is never stored in agent_events (the first name is). */
function loggedInput(input: Record<string, unknown>): Json {
  const copy: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    copy[key] = key === "email" ? "(given)" : (value as Json);
  }
  return copy;
}

// ---------------------------------------------------------------------------------------------------------------
// Input schemas (exported for tests)
// ---------------------------------------------------------------------------------------------------------------

const LocalDateInput = z.iso.date().describe("A date, YYYY-MM-DD, in the pro's time zone.");

export const inputs = {
  search_pros: {
    city: z.string().min(2).max(80).optional().describe('City, e.g. "Milan", "Lyon", "London".'),
    service: z.string().min(2).max(120).optional().describe('What the human wants, e.g. "knotless braids", "gel nails".'),
    max_price: z.number().positive().max(10_000).optional().describe("Highest acceptable starting price, in major units (150 = €150)."),
    currency: z.enum(["EUR", "GBP"]).optional().describe("Only pros who charge in this currency."),
    date: LocalDateInput.optional().describe(
      "Only pros with a free time for the service on this date (YYYY-MM-DD, the pro's local date). Without it, the next 7 days are searched.",
    ),
    time_of_day: z
      .enum(TIMES_OF_DAY)
      .optional()
      .describe("Part of the day for the free times: morning (before 12:00), afternoon (12:00–17:00), evening (after 17:00) or any (default)."),
  },
  get_availability: {
    pro_handle: z.string().min(2).max(60).describe('The pro\'s handle from search_pros, e.g. "aicha.braids".'),
    service_id: z.uuid().describe("The service_id from search_pros."),
    date_from: LocalDateInput,
    date_to: LocalDateInput.describe("Last date included, YYYY-MM-DD (at most 14 days after date_from)."),
  },
  book_with_deposit: {
    pro_handle: z.string().min(2).max(60),
    service_id: z.uuid(),
    start: z.iso
      .datetime({ offset: true })
      .describe("A start value from search_pros (free_times[].start) or get_availability (slots[].start), ISO 8601."),
    first_name: z.string().trim().min(1).max(60).describe("The human's first name, for the pro's calendar."),
    email: z.email().max(200).optional().describe("Optional: where PayPal and the pro send the receipt."),
    locale: z.enum(LOCALES).optional().describe("Language of the deposit page and messages. Default en."),
  },
  booking_status: {
    ref: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6}$/, "6 letters or digits")
      .describe("The booking ref returned by book_with_deposit."),
  },
} as const;

const MAX_DAYS = 14;
const MAX_SLOTS = 40;
/** search_pros: free times shown per pro, services tried per pro, days searched without a date. */
const SEARCH_TIMES = 4;
const SEARCH_SERVICES = 6;
const SEARCH_DAYS = 7;

// ---------------------------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------------------------

/** The "Book with Kitoko" MCP server: four tools over the same services as the chat agents. One per request. */
export function createKitokoMcpServer(ctxFactory: CtxFactory, options: KitokoMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: "kitoko", title: "Book with Kitoko", version: "1.0.0", websiteUrl: "https://kitoko.page" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  /** Runs a tool, never throws, and logs the call to agent_events. */
  async function run(name: string, input: Record<string, unknown>, body: (ctx: ServicesCtx) => Promise<Outcome>): Promise<CallToolResult> {
    const started = performance.now();
    let ctx: ServicesCtx | null = null;
    let outcome: Outcome;
    let detail: string | undefined;
    try {
      ctx = await ctxFactory();
      outcome = await body(ctx);
    } catch (cause) {
      detail = cause instanceof Error ? cause.message : String(cause);
      outcome = fail("internal_error", "Something went wrong on Kitoko's side. Try again in a minute.");
    }
    if (ctx) {
      const link = outcome.link ?? {};
      await logAgentEvent(ctx.db, {
        proId: link.proId ?? null,
        bookingId: link.bookingId ?? null,
        conversationId: link.conversationId ?? null,
        kind: outcome.ok ? "tool" : "error",
        name: `mcp.${name}`,
        input: loggedInput(input),
        output: outcome.ok ? outcome.summary : { error: outcome.error, ...(detail ? { detail } : {}) },
        ms: performance.now() - started,
      }).catch(() => undefined);
    }
    return toResult(outcome);
  }

  const siteUrl = (ctx: ServicesCtx, path: string) => new URL(path, ctx.siteUrl).toString();

  /** A published pro by handle, or null. */
  async function livePro(ctx: ServicesCtx, handle: string): Promise<Pro | null> {
    const pro = await getProByHandle(ctx.db, handle.trim().replace(/^@/, ""));
    return pro?.publishedAt ? pro : null;
  }

  // -- search_pros --------------------------------------------------------------------------------------------------

  server.registerTool(
    "search_pros",
    {
      title: "Search beauty pros",
      description: `Find beauty pros on Kitoko by city, service, maximum starting price, date and time of day. Returns one option per pro: name, pro_handle, area, page_url, the matching service (service_id, name, minutes), its price in the standard version and its starting price ("from"), what is paid now through PayPal (deposit + booking fee), the balance paid at the salon, the cancellation rule, and up to ${SEARCH_TIMES} free start times (ISO + local time), sorted by earliest free time then price. ${CHOOSE} ${NO_REVIEWS} Next: book_with_deposit with a free_times start, or get_availability for more times.`,
      inputSchema: inputs.search_pros,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      run("search_pros", input, async (ctx) => {
        const part = input.time_of_day ?? "any";
        const listings = await listPros(ctx.db, input.currency ? { currency: input.currency } : {});
        const trades = input.service ? tradesOf(input.service) : [];
        const found: { first: number; priceCents: number; option: Record<string, unknown> }[] = [];
        for (const listing of listings) {
          if (input.city && !cityMatches(listing.city, input.city)) continue;
          let services = listing.services;
          if (input.service) {
            const byName = services.filter((s) => serviceMatches(s.name, input.service!));
            // "braids" with no service named so: every service of a braider.
            services = byName.length > 0 ? byName : listing.trades.some((t) => trades.includes(t)) ? services : [];
          }
          if (input.max_price !== undefined) services = services.filter((s) => s.fromPriceCents <= Math.round(input.max_price! * 100));
          if (services.length === 0) continue;

          const tz = listing.timezone;
          const range = input.date
            ? localRange(input.date, input.date, tz)
            : localRange(localDate(ctx.now().getTime(), tz), addDays(localDate(ctx.now().getTime(), tz), SEARCH_DAYS - 1), tz);
          // The first matching service (menu order) with a free time in that part of the day.
          let chosen = services[0]!;
          let times: { start: string; local: string }[] = [];
          for (const s of services.slice(0, SEARCH_SERVICES)) {
            const slots = await findSlots(ctx, { proId: listing.id, serviceId: s.id, from: range.from, to: range.to, limit: 200 });
            const fitting = slots.ok ? slots.value.filter((slot) => inTimeOfDay(Date.parse(slot.start), tz, part)) : [];
            if (fitting.length > 0) {
              chosen = s;
              times = fitting.slice(0, SEARCH_TIMES).map((slot) => ({ start: slot.start, local: localTime(Date.parse(slot.start), tz) }));
              break;
            }
          }
          if (input.date && times.length === 0) continue;

          const [quote, pro] = await Promise.all([
            quoteService(ctx, { proId: listing.id, serviceId: chosen.id, locale: "en" }),
            getPro(ctx.db, listing.id),
          ]);
          if (!quote.ok || !pro) continue;
          const q = quote.value;
          const others = services.filter((s) => s.id !== chosen.id).slice(0, 6);
          found.push({
            first: times[0] ? Date.parse(times[0].start) : Number.POSITIVE_INFINITY,
            priceCents: q.priceCents,
            option: {
              pro_handle: listing.handle,
              name: listing.name,
              city: listing.city,
              area: listing.areaLabel,
              page_url: siteUrl(ctx, `/${listing.handle}`),
              currency: q.currency,
              timezone: tz,
              service: {
                service_id: chosen.id,
                name: chosen.name,
                minutes: q.minutes,
                price: money(q.priceCents, q.currency),
                from_price: money(chosen.fromPriceCents, q.currency),
              },
              pay_now: {
                deposit: money(q.depositCents, q.currency),
                booking_fee: money(q.feeCents, q.currency),
                total: money(q.totalNowCents, q.currency),
              },
              balance_at_salon: money(q.balanceCents, q.currency),
              cancellation: cancellationRule(pro.rules, q.currency),
              free_times: times,
              ...(others.length > 0
                ? {
                    other_services: others.map((s) => ({
                      service_id: s.id,
                      name: s.name,
                      from_price: money(s.fromPriceCents, q.currency),
                      duration: minutesRange(s.minMinutes, s.maxMinutes),
                    })),
                  }
                : {}),
            },
          });
        }
        found.sort((a, b) => a.first - b.first || a.priceCents - b.priceCents);
        const pros = found.map((f) => f.option);
        const value = {
          ...(input.date ? { date: input.date } : { days_searched: SEARCH_DAYS }),
          time_of_day: part,
          pros,
          count: pros.length,
          note:
            pros.length > 0
              ? `price is the standard version (default options), from_price the cheapest options; max_price compares from_price. ${CHOOSE} Then call book_with_deposit with pro_handle, service.service_id and one free_times start. ${NO_REVIEWS}`
              : "No pro matches. Try without max_price, date or time_of_day, or another city (Kitoko's demo pros are in Milan, Lyon and London).",
        };
        return {
          ok: true,
          value,
          summary: { pros: found.map((f) => [f.option.pro_handle as string, Number.isFinite(f.first) ? new Date(f.first).toISOString() : null]) },
        };
      }),
  );

  // -- get_availability ---------------------------------------------------------------------------------------------

  server.registerTool(
    "get_availability",
    {
      title: "Free times and quote",
      description:
        "Free start times of one service of a pro between two dates (at most 14 days), plus the exact quote: price, deposit paid now through PayPal, booking fee, total paid now, and the cancellation policy. Next: book_with_deposit with one of the start values.",
      inputSchema: inputs.get_availability,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      run("get_availability", input, async (ctx) => {
        if (input.date_to < input.date_from) return fail("invalid_dates", "date_to is before date_from.");
        const days = dayCount(input.date_from, input.date_to);
        const dateTo = days > MAX_DAYS ? addDays(input.date_from, MAX_DAYS - 1) : input.date_to;
        const pro = await livePro(ctx, input.pro_handle);
        if (!pro) return fail("pro_not_found", `No pro with the handle "${input.pro_handle}". Use a pro_handle from search_pros.`);
        const service = await getService(ctx.db, pro.id, input.service_id);
        if (!service?.active) return fail("service_not_found", "This pro has no such service. Use a service_id from search_pros.", { proId: pro.id });

        const range = localRange(input.date_from, dateTo, pro.timezone);
        const [quote, slots] = await Promise.all([
          quoteService(ctx, { proId: pro.id, serviceId: service.id, locale: "en" }),
          findSlots(ctx, { proId: pro.id, serviceId: service.id, from: range.from, to: range.to, limit: MAX_SLOTS }),
        ]);
        if (!quote.ok) return fail(quote.error, "Kitoko could not price this service.", { proId: pro.id });
        if (!slots.ok) return fail(slots.error, "Kitoko could not read the free times.", { proId: pro.id });

        // findSlots spreads at most MAX_SLOTS starts over the days (each day's earliest first).
        const shown = slots.value.map((slot) => ({ start: slot.start, local: localTime(Date.parse(slot.start), pro.timezone) }));
        const q = quote.value;
        const value = {
          pro: { pro_handle: pro.handle, name: pro.name, city: pro.city, page_url: siteUrl(ctx, `/${pro.handle}`) },
          service: { service_id: service.id, name: q.serviceName, minutes: q.minutes },
          timezone: pro.timezone,
          quote: {
            currency: q.currency,
            price: money(q.priceCents, q.currency),
            deposit_now: money(q.depositCents, q.currency),
            booking_fee_now: money(q.feeCents, q.currency),
            total_now: money(q.totalNowCents, q.currency),
            balance_at_salon: money(q.balanceCents, q.currency),
            policy: q.policySummary,
          },
          date_from: input.date_from,
          date_to: dateTo,
          slots: shown,
          ...(shown.length >= MAX_SLOTS ? { note: "Not every free time is listed: narrow the dates to see the others." } : {}),
          ...(days > MAX_DAYS ? { range_note: `Only the first ${MAX_DAYS} days are searched.` } : {}),
        };
        return {
          ok: true,
          value,
          summary: { service: q.serviceName, slots: slots.value.length, first: shown[0]?.start ?? null, total_now_cents: q.totalNowCents },
          link: { proId: pro.id },
        };
      }),
  );

  // -- book_with_deposit --------------------------------------------------------------------------------------------

  server.registerTool(
    "book_with_deposit",
    {
      title: "Hold a time and get the PayPal approval link",
      description:
        "Holds one free start time (until expires_at, 30 minutes) and creates the PayPal deposit order. Returns the booking ref, expires_at and approval_url: the human must open approval_url and approve the payment themselves. The booking is confirmed only after they approve; you cannot pay on their behalf. Confirm the time and the quote with the human before calling.",
      inputSchema: inputs.book_with_deposit,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) =>
      run("book_with_deposit", input, async (ctx) => {
        if (options.allowHold && !options.allowHold()) {
          return fail("rate_limited", "Too many bookings from this address in the last hour. Try again later.");
        }
        const pro = await livePro(ctx, input.pro_handle);
        if (!pro) return fail("pro_not_found", `No pro with the handle "${input.pro_handle}".`);
        const service = await getService(ctx.db, pro.id, input.service_id);
        if (!service?.active) return fail("service_not_found", "This pro has no such service.", { proId: pro.id });
        const locale: Locale = input.locale ?? "en";

        const hold = await holdSlot(ctx, {
          proId: pro.id,
          serviceId: service.id,
          start: input.start,
          source: "mcp",
          locale,
        });
        if (!hold.ok) {
          if (!TAKEN_ERRORS.has(hold.error)) return fail(hold.error, HOLD_ERRORS[hold.error] ?? "Kitoko could not hold that time.", { proId: pro.id });
          // Someone else (a web chat, another agent) holds or took that time: offer the nearest free starts.
          const near = await alternativesNear(ctx, { proId: pro.id, serviceId: service.id, start: input.start });
          return fail(
            hold.error,
            `${HOLD_ERRORS[hold.error] ?? "That time is not free."} ${near.length ? "alternatives lists the nearest free start times: show them to the human." : "No free time in the next 7 days."}`,
            { proId: pro.id },
            { alternatives: near.map((t) => ({ start: t.start, local: localTime(Date.parse(t.start), pro.timezone) })) },
          );
        }
        const booking = hold.value;

        // One conversation per MCP booking (external_id = ref), so the booking has a channel and a timeline.
        const conversation = await getOrCreateConversation(ctx.db, {
          proId: pro.id,
          kind: "client",
          channel: "mcp",
          externalId: booking.ref,
          locale,
        });
        await ctx.db.from("bookings").update({ conversation_id: conversation.id }).eq("id", booking.bookingId).throwOnError();
        const link = { proId: pro.id, bookingId: booking.bookingId, conversationId: conversation.id };

        const deposit = await createDepositLink(ctx, {
          bookingId: booking.bookingId,
          firstName: input.first_name,
          ...(input.email ? { email: input.email } : {}),
        });
        if (!deposit.ok) {
          await releaseHold(ctx.db, booking.bookingId);
          return fail(deposit.error, "PayPal could not create the deposit order; the time was released. Try again.", link);
        }

        const c = booking.currency;
        // Nothing due online (no deposit rule): createDepositLink confirmed the booking directly.
        const confirmed = deposit.value.approveUrl === null;
        const value = {
          ref: booking.ref,
          status: confirmed ? "confirmed" : "held",
          pro: { name: pro.name, pro_handle: pro.handle },
          service: service.name.fr,
          start: booking.start,
          end: booking.end,
          local: localTime(Date.parse(booking.start), pro.timezone),
          timezone: pro.timezone,
          staff: booking.staffName,
          amounts: {
            currency: c,
            price: money(booking.priceCents, c),
            deposit_now: money(booking.depositCents, c),
            booking_fee_now: money(booking.feeCents, c),
            total_now: money(deposit.value.amountCents, deposit.value.currency),
            balance_at_salon: money(booking.priceCents - booking.depositCents, c),
          },
          approval_url: deposit.value.approveUrl,
          pay_page_url: deposit.value.payUrl,
          expires_at: confirmed ? null : booking.holdExpiresAt,
          next_step: confirmed ? "Nothing to pay online: the booking is confirmed. The price is paid at the salon." : NEXT_STEP,
        };
        return {
          ok: true,
          value,
          summary: {
            ref: booking.ref,
            start: value.start,
            total_now_cents: deposit.value.amountCents,
            currency: deposit.value.currency,
            paypal_order_id: deposit.value.orderId,
          },
          link,
        };
      }),
  );

  // -- booking_status -----------------------------------------------------------------------------------------------

  server.registerTool(
    "booking_status",
    {
      title: "Booking status",
      description:
        "Status of a booking by its ref: held (waiting for the PayPal approval), confirmed (deposit paid), cancelled, expired, done. Also the time, the service, the pro and what was paid or refunded. Never returns the client's personal data.",
      inputSchema: inputs.booking_status,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (input) =>
      run("booking_status", input, async (ctx) => {
        const booking = await getBookingByRef(ctx.db, input.ref);
        if (!booking) return fail("not_found", `No booking with the ref ${input.ref.toUpperCase()}.`);
        const pro = await getPro(ctx.db, booking.proId);
        const tz = pro?.timezone ?? "UTC";
        const c = booking.currency;
        const value = {
          ref: booking.ref,
          status: booking.status,
          status_text: STATUS_TEXT[booking.status] ?? booking.status,
          start: new Date(booking.start).toISOString(),
          end: new Date(booking.end).toISOString(),
          local: localTime(booking.start, tz),
          timezone: tz,
          service: booking.service.name,
          staff: booking.staff.name,
          pro: pro ? { name: pro.name, pro_handle: pro.handle, page_url: siteUrl(ctx, `/${pro.handle}`) } : null,
          paid: booking.money.paidCents > 0,
          refunded: booking.money.refundedCents > 0,
          amounts: {
            currency: c,
            price: money(booking.priceCents, c),
            paid: money(booking.money.paidCents, c),
            refunded: money(booking.money.refundedCents, c),
            balance_at_salon: money(booking.balanceCents, c),
          },
          ...(booking.status === "held" && booking.holdExpiresAt ? { expires_at: new Date(booking.holdExpiresAt).toISOString() } : {}),
          ...(booking.displacedAt ? { note: "The pro had to move this appointment; she will propose a new time." } : {}),
        };
        return {
          ok: true,
          value,
          summary: { ref: booking.ref, status: booking.status, paid_cents: booking.money.paidCents },
          link: { proId: booking.proId, bookingId: booking.id, conversationId: booking.conversationId },
        };
      }),
  );

  return server;
}
