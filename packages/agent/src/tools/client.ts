import "server-only";
import { z } from "zod";
import { bookableUntil, fromPrice, localDate, LOCALES, pickText, rulesText } from "@kitoko/booking";
import type { Locale } from "@kitoko/booking";
import { ok } from "@kitoko/booking/result";
import { getBooking, listServices, updateConversation } from "@kitoko/db";
import type { BookingDetail, BookingSource, Conversation, Pro } from "@kitoko/db";
import { defineTool, toolError } from "../core/tools";
import type { Tool } from "../core/tools";
import { CLIENT_TOOLS } from "../prompts/client";
import {
  alternativesNear,
  cancelBooking,
  declineProposal,
  findSlots,
  holdSlot,
  pendingProposal,
  previewCancellation,
  quoteService,
  releaseSlot,
  rescheduleBooking,
  TAKEN_ERRORS,
} from "../services/booking";
import type { CancelPreview } from "../services/booking";
import { conversationBookings } from "../services/conversation";
import type { ServicesCtx } from "../services/ctx";
import { asE164, createDepositLink } from "../services/payments";
import { localLabel, logEvent, moneyText, nowMs } from "../services/util";
import { describeBooking, localRange } from "./describe";

/** A preview older than this is shown again before cancelling (the policy tier may have changed). */
const PREVIEW_TTL_MS = 30 * 60_000;

/** What a client tool runs with: one pro, one conversation; it only sees that conversation's bookings. */
export type ClientToolCtx = {
  services: ServicesCtx;
  pro: Pro;
  conversation: Conversation;
  source: BookingSource;
  /**
   * This run: whether it answers the client's own message (not an [event]), and the bookings whose cancellation was
   * previewed in it. A cancellation needs a preview from an EARLIER run, so the client said yes in a later message.
   */
  turn?: { byClient: boolean; previewed: Set<string> };
};

const tool = defineTool<ClientToolCtx>();

const selectionInput = {
  options: z
    .record(z.string(), z.string())
    .optional()
    .describe("The client's choice per option group, as { group_id: option_id } from list_services. Groups left out take their default."),
  addons: z.array(z.string()).optional().describe("Add-on ids from list_services the client wants."),
};

const bookingInput = z.string().min(1).describe("booking_id (or the 6-character ref) from hold_slot or list_my_bookings.");

const ERRORS: Record<string, string> = {
  slot_unavailable: "That time is not free for this service. Call get_availability and offer other times.",
  slot_taken: "That time was just taken. Apologise and offer other times from get_availability.",
  slot_blocked: "That time is blocked by the pro. Offer other times from get_availability.",
  too_many_holds: "This conversation already holds several times. Ask which one the client wants to keep.",
  hold_expired: "The hold expired. Offer to hold the time again with hold_slot.",
  already_confirmed: "This booking is already confirmed and paid.",
  not_found: "There is no such booking in this conversation.",
  service_not_found: "There is no such service. Call list_services for the service ids.",
  missing_option: "An option group has no default: ask the client which option they want.",
  unknown_option: "One of the options is not valid for this service. Use the ids from list_services.",
  unknown_addon: "One of the add-ons is not valid for this service. Use the ids from list_services.",
  too_late: "Under the pro's policy it is too late to move this booking yourself. Offer to cancel (policy applies) or hand off to the pro.",
  limit_reached: "Under the pro's policy this booking cannot be moved again. Offer to cancel (policy applies) or hand off to the pro.",
  past: "This booking has already started or is in the past.",
  not_reschedulable: "This booking cannot be moved (it is not a confirmed booking).",
  not_cancellable: "This booking cannot be cancelled (it is not a confirmed or held booking).",
  paypal_unavailable: "PayPal is not answering right now. Ask the client to try again in a minute.",
  paypal_error: "PayPal refused to create the payment. Hand off to the pro.",
  invalid_dates: "The dates are not valid: use YYYY-MM-DD.",
  invalid_start: "The start time is not valid: use a start from get_availability.",
  same_time: "The booking is already at that time.",
  no_proposal: "There is no time proposed by the pro waiting for an answer on this booking.",
};

const fail = (code: string) => toolError(code, ERRORS[code]);

/**
 * The pro's fixed session start times per weekday for a session of `minutes` ("mon": ["09:00", "13:00"]), leaving out
 * starts that would end after closing; null when she takes any time on the grid.
 */
function startTimes(pro: Pro, minutes: number): Record<string, string[] | "closed"> | null {
  const days = Object.entries(pro.schedule.weekly);
  if (!days.some(([, h]) => h?.starts)) return null;
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Object.fromEntries(
    days.map(([d, h]) => {
      if (!h) return [d, "closed"];
      if (!h.starts) return [d, [`every ${pro.schedule.stepMinutes} min ${h.open}-${h.close}`]];
      const fits = h.starts.filter((t) => min(t) + minutes <= min(h.close));
      return [d, fits.length ? fits : "closed"];
    }),
  );
}

/** The booking if this conversation may see it (its own bookings, or the same WhatsApp number's). */
async function scoped(c: ClientToolCtx, idOrRef: string): Promise<BookingDetail | null> {
  const key = idOrRef.trim();
  const all = await conversationBookings(c.services, c.conversation);
  return all.find((b) => b.id === key || b.ref === key.toUpperCase()) ?? null;
}

const locale = (c: ClientToolCtx): Locale => c.conversation.locale;

const languageInput = z
  .enum(LOCALES)
  .optional()
  .describe("The language the client writes in (en, fr, it, es, pt): amounts come back written that way, and the payment page uses it.");

/** The client's language, as the model reads it from her messages: remembered on the conversation. */
async function useLanguage(c: ClientToolCtx, lang: Locale | undefined): Promise<Locale> {
  if (lang && lang !== c.conversation.locale) {
    await updateConversation(c.services.db, c.conversation.id, { locale: lang });
    c.conversation = { ...c.conversation, locale: lang };
  }
  return locale(c);
}
const money = (c: ClientToolCtx, cents: number) => moneyText(cents, locale(c), c.pro.currency);

/** The client-facing sentences tools return, in the conversation's language (the model passes them on as they are). */
const TEXT: Record<
  Locale,
  {
    freeAnyTime: string;
    freeUntil: (until: string) => string;
    keep: (percent: number) => string;
    byPro: (pro: string) => string;
    nothingPaid: string;
    inWindow: string;
    late: (pro: string) => string;
  }
> = {
  en: {
    freeAnyTime: "Free cancellation at any time (the booking fee is not refunded).",
    freeUntil: (until) => `Free cancellation until ${until}: the deposit is refunded, the booking fee is not. After that, the policy keeps part or all of the deposit.`,
    keep: (p) => `If cancelled now, ${p}% of the deposit is kept under the policy; the booking fee is not refunded.`,
    byPro: (pro) => `${pro} could not keep the appointment, so everything paid is refunded, booking fee included.`,
    nothingPaid: "Nothing had been paid online.",
    inWindow: "Cancelled within the free cancellation window: the deposit is refunded; the booking fee is not refunded.",
    late: (pro) => `Cancelled late under the policy: part or all of the deposit is kept for ${pro}; the booking fee is not refunded.`,
  },
  fr: {
    freeAnyTime: "Annulation gratuite à tout moment (les frais de réservation ne sont pas remboursés).",
    freeUntil: (until) =>
      `Annulation gratuite jusqu’au ${until} : l’acompte est remboursé, les frais de réservation ne le sont pas. Ensuite, la politique d’annulation garde une partie ou la totalité de l’acompte.`,
    keep: (p) => `En cas d’annulation maintenant, ${p} % de l’acompte est gardé selon la politique d’annulation ; les frais de réservation ne sont pas remboursés.`,
    byPro: (pro) => `${pro} ne peut pas assurer le rendez-vous : tout ce qui a été payé est remboursé, frais de réservation compris.`,
    nothingPaid: "Rien n’avait été payé en ligne.",
    inWindow: "Annulé dans le délai d’annulation gratuite : l’acompte est remboursé ; les frais de réservation ne sont pas remboursés.",
    late: (pro) => `Annulation tardive selon la politique : une partie ou la totalité de l’acompte est gardée pour ${pro} ; les frais de réservation ne sont pas remboursés.`,
  },
  it: {
    freeAnyTime: "Annullamento gratuito in qualsiasi momento (il costo di prenotazione non viene rimborsato).",
    freeUntil: (until) =>
      `Annullamento gratuito fino a ${until}: l’acconto viene rimborsato, il costo di prenotazione no. Dopo, secondo la politica, l’acconto viene trattenuto in parte o del tutto.`,
    keep: (p) => `In caso di annullamento adesso, secondo la politica viene trattenuto il ${p}% dell’acconto; il costo di prenotazione non viene rimborsato.`,
    byPro: (pro) => `${pro} non può mantenere l’appuntamento, quindi tutto ciò che è stato pagato viene rimborsato, costo di prenotazione incluso.`,
    nothingPaid: "Non era stato pagato nulla online.",
    inWindow: "Annullato entro il periodo di annullamento gratuito: l’acconto viene rimborsato; il costo di prenotazione non viene rimborsato.",
    late: (pro) => `Annullamento tardivo secondo la politica: l’acconto viene trattenuto in parte o del tutto per ${pro}; il costo di prenotazione non viene rimborsato.`,
  },
  es: {
    freeAnyTime: "Cancelación gratuita en cualquier momento (los gastos de reserva no se reembolsan).",
    freeUntil: (until) =>
      `Cancelación gratuita hasta el ${until}: se reembolsa la señal, pero no los gastos de reserva. Después, según la política, se retiene una parte o la totalidad de la señal.`,
    keep: (p) => `Si cancela ahora, según la política se retiene el ${p} % de la señal; los gastos de reserva no se reembolsan.`,
    byPro: (pro) => `${pro} no puede mantener la cita, así que se reembolsa todo lo pagado, gastos de reserva incluidos.`,
    nothingPaid: "No se había pagado nada en línea.",
    inWindow: "Cancelada dentro del plazo de cancelación gratuita: se reembolsa la señal; los gastos de reserva no se reembolsan.",
    late: (pro) => `Cancelación tardía según la política: una parte o la totalidad de la señal se retiene para ${pro}; los gastos de reserva no se reembolsan.`,
  },
  pt: {
    freeAnyTime: "Cancelamento gratuito a qualquer momento (a taxa de reserva não é reembolsada).",
    freeUntil: (until) =>
      `Cancelamento gratuito até ${until}: o sinal é reembolsado, a taxa de reserva não. Depois disso, segundo a política, é retido parte ou todo o sinal.`,
    keep: (p) => `Se cancelar agora, segundo a política é retido ${p}% do sinal; a taxa de reserva não é reembolsada.`,
    byPro: (pro) => `${pro} não pode manter a marcação, por isso tudo o que foi pago é reembolsado, incluindo a taxa de reserva.`,
    nothingPaid: "Não tinha sido pago nada online.",
    inWindow: "Cancelada dentro do prazo de cancelamento gratuito: o sinal é reembolsado; a taxa de reserva não é reembolsada.",
    late: (pro) => `Cancelamento tardio segundo a política: parte ou todo o sinal fica para ${pro}; a taxa de reserva não é reembolsada.`,
  },
};

const text = (c: ClientToolCtx) => TEXT[locale(c)];

/** "Friday 6 November, 09:00" / "venerdì 6 novembre alle ore 09:00": salon time, the conversation's language. */
const when = (c: ClientToolCtx, at: number) => localLabel(at, c.pro.timezone, locale(c));

function cancellationText(c: ClientToolCtx, q: { cancellation?: { kind: string; until?: string; keepPercent?: number } }): string | null {
  const x = q.cancellation;
  if (!x) return null;
  if (x.kind === "free") return text(c).freeAnyTime;
  if (x.kind === "freeUntil" && x.until) return text(c).freeUntil(when(c, Date.parse(x.until)));
  return text(c).keep(x.keepPercent ?? 100);
}

/** Why the money splits this way, in the client's language. */
function outcomeReason(c: ClientToolCtx, x: { refundCents: number; keptCents: number }, byPro: boolean): string {
  if (byPro) return text(c).byPro(c.pro.name);
  if (x.refundCents === 0 && x.keptCents === 0) return text(c).nothingPaid;
  return x.keptCents === 0 ? text(c).inWindow : text(c).late(c.pro.name);
}

/**
 * Did the client see this exact outcome in an earlier run of this conversation (a cancel_previewed event, under 30
 * minutes old, same amounts), and is this run her own message? Only then may confirm true cancel.
 */
async function previewedBefore(c: ClientToolCtx, bookingId: string, now: CancelPreview): Promise<boolean> {
  if (c.turn && (!c.turn.byClient || c.turn.previewed.has(bookingId))) return false;
  const { data } = await c.services.db
    .from("agent_events")
    .select("output, created_at")
    .eq("kind", "system")
    .eq("name", "cancel_previewed")
    .eq("booking_id", bookingId)
    .eq("conversation_id", c.conversation.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  if (nowMs(c.services) - Date.parse(data.created_at) > PREVIEW_TTL_MS) return false;
  const seen = data.output as { refundCents?: number; keptCents?: number; feeKeptCents?: number } | null;
  return seen?.refundCents === now.refundCents && seen.keptCents === now.keptCents && seen.feeKeptCents === now.feeKeptCents;
}

export const clientTools: Tool<z.ZodType, ClientToolCtx>[] = [
  tool({
    name: CLIENT_TOOLS.offerChoices,
    description:
      "Shows the options you just listed as tap-to-reply buttons under your message (web chat). Up to 4 short replies, each as the client would type it. Call it alone, last, after your text: it ends your turn.",
    input: z.object({ choices: z.array(z.string().trim().min(1).max(40)).min(1).max(4) }),
    run: async (input) => ok({ choices: [...new Set(input.choices)] }),
    final: true,
  }),
  tool({
    name: CLIENT_TOOLS.listServices,
    description:
      "Lists the pro's services with their service_id, starting price, duration, option groups (with option ids and what each adds) and add-ons. Call it before get_availability.",
    input: z.object({ language: languageInput }),
    run: async (input, c) => {
      const l = await useLanguage(c, input.language);
      const services = await listServices(c.services.db, c.pro.id);
      return ok({
        currency: c.pro.currency,
        services: services.map((s) => {
          const from = fromPrice(s);
          return {
            service_id: s.id,
            name: s.name.fr,
            ...(s.description ? { description: s.description } : {}),
            from_price: money(c, from.priceCents),
            minutes: from.minMinutes === from.maxMinutes ? from.minMinutes : `${from.minMinutes}-${from.maxMinutes}`,
            option_groups: s.optionGroups.map((g) => ({
              group_id: g.id,
              label: pickText(g.label, l),
              default: g.default ?? null,
              options: g.options.map((o) => ({ option_id: o.id, label: pickText(o.label, l), adds_price: money(c, o.priceCents), adds_minutes: o.minutes })),
            })),
            addons: s.addons.map((a) => ({ addon_id: a.id, label: pickText(a.label, l), price: money(c, a.priceCents), adds_minutes: a.minutes })),
            ...(s.conditions.length ? { conditions: s.conditions.map((t) => pickText(t, l)) } : {}),
            ...(s.prepInstructions ? { preparation: s.prepInstructions } : {}),
          };
        }),
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.getAvailability,
    description:
      "Free start times for one service and the client's options, between two dates (salon time zone), with the exact quote: price, deposit, booking fee, total to pay now and the policy. Returns at most 20 times spread over the days.",
    input: z.object({
      service_id: z.string().min(1),
      date_from: z.string().optional().describe("First day, YYYY-MM-DD in the salon's time zone. Default: today."),
      date_to: z.string().optional().describe("Last day (inclusive), YYYY-MM-DD. Default: 6 days after date_from. At most 14 days after date_from."),
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .describe("A time the client asked for (HH:MM, salon time). Returns, for each day, that start if free, else the nearest free starts."),
      ...selectionInput,
      language: languageInput,
    }),
    run: async (input, c) => {
      await useLanguage(c, input.language);
      const now = nowMs(c.services);
      const range = localRange(c.pro.timezone, now, input.date_from, input.date_to);
      if (!range || range.to - range.from > 15 * 86_400_000) return fail("invalid_dates");
      const selection = { ...(input.options ? { options: input.options } : {}), ...(input.addons ? { addons: input.addons } : {}) };
      const [q, slots] = await Promise.all([
        quoteService(c.services, { proId: c.pro.id, serviceId: input.service_id, selection, locale: locale(c) }),
        findSlots(c.services, { proId: c.pro.id, serviceId: input.service_id, selection, from: range.from, to: range.to, ...(input.time ? { time: input.time } : {}) }),
      ]);
      if (!q.ok) return fail(q.error);
      if (!slots.ok) return fail(slots.error);
      const until = bookableUntil({ now, tz: c.pro.timezone, window: c.pro.schedule.window, openings: [] }).until;
      return ok({
        service: q.value.serviceName,
        minutes: q.value.minutes,
        quote: {
          price: money(c, q.value.priceCents),
          deposit_now: money(c, q.value.depositCents),
          booking_fee_now: money(c, q.value.feeCents),
          total_now: money(c, q.value.totalNowCents),
          balance_at_salon: money(c, q.value.balanceCents),
          booking_fee_refunded_if_client_cancels: false,
          policy: q.value.policySummary,
        },
        timezone: c.pro.timezone,
        ...(startTimes(c.pro, q.value.minutes) ? { session_start_times: startTimes(c.pro, q.value.minutes) } : {}),
        searched: { from: localDate(range.from, c.pro.timezone), to: localDate(range.to - 1, c.pro.timezone), ...(input.time ? { time: input.time } : {}) },
        bookable_until: until,
        ...(localDate(range.from, c.pro.timezone) > until
          ? { window_note: `Bookings are only open until ${until}: these dates cannot be booked yet. Say so, and offer times before it.` }
          : {}),
        slots: slots.value.map((s) => ({ start: s.start, local: when(c, Date.parse(s.start)) })),
        ...(slots.value.length === 0 ? { note: "No free time in these dates. Try other dates." } : {}),
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.holdSlot,
    description:
      "Holds a start time from get_availability for this client until held_until (15 minutes on the web, 30 on WhatsApp). Returns booking_id, ref and the exact amounts. Then call create_deposit_link with the booking_id. Holding another time releases this conversation's previous hold, unless for_another_person.",
    input: z.object({
      service_id: z.string().min(1),
      start: z.string().min(1).describe("A start exactly as get_availability returned it (ISO)."),
      ...selectionInput,
      for_another_person: z
        .boolean()
        .optional()
        .describe("True when this is a second person's booking (a friend, a sister): the client's other holds are kept. Each booking has its own deposit."),
      language: languageInput,
    }),
    run: async (input, c) => {
      const lang = await useLanguage(c, input.language);
      const selection = { ...(input.options ? { options: input.options } : {}), ...(input.addons ? { addons: input.addons } : {}) };
      const held = await holdSlot(c.services, {
        proId: c.pro.id,
        serviceId: input.service_id,
        selection,
        start: input.start,
        source: c.source,
        conversationId: c.conversation.id,
        locale: lang,
      });
      if (!held.ok) {
        if (!TAKEN_ERRORS.has(held.error)) return fail(held.error);
        // Two clients on one time (this chat and an MCP agent, two chats): the other one won. Offer real times nearby.
        const near = await alternativesNear(c.services, { proId: c.pro.id, serviceId: input.service_id, selection, start: input.start });
        const list = near.map((s) => `${s.start} (${when(c, Date.parse(s.start))})`).join("; ");
        return toolError(
          held.error,
          `${ERRORS[held.error] ?? ERRORS.slot_unavailable} ${list ? `Free times nearby (start values for hold_slot): ${list}.` : "No free time in the next 7 days: call get_availability for later dates."}`,
        );
      }
      const h = held.value;
      // One live hold per conversation: the client picked this time instead of an earlier one.
      const others = input.for_another_person
        ? []
        : (await conversationBookings(c.services, c.conversation)).filter((b) => b.status === "held" && b.id !== h.bookingId && b.conversationId === c.conversation.id);
      await Promise.all(others.map((b) => releaseSlot(c.services, { bookingId: b.id })));
      const q = await quoteService(c.services, { proId: c.pro.id, serviceId: input.service_id, selection, locale: lang, start: h.start });
      return ok({
        booking_id: h.bookingId,
        ref: h.ref,
        status: "held",
        start: h.start,
        local: when(c, Date.parse(h.start)),
        with: h.staffName,
        held_until: when(c, Date.parse(h.holdExpiresAt)),
        amounts: {
          price: money(c, h.priceCents),
          deposit_now: money(c, h.depositCents),
          booking_fee_now: money(c, h.feeCents),
          total_now: money(c, h.depositCents + h.feeCents),
          balance_at_salon: money(c, h.priceCents - h.depositCents),
        },
        cancellation: q.ok ? cancellationText(c, q.value) : null,
        ...(others.length ? { released_previous_holds: others.map((b) => b.ref) } : {}),
        next: "Call create_deposit_link with this booking_id.",
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.createDepositLink,
    description:
      "Creates the PayPal deposit payment for a held booking and returns pay_url, the link to send to the client. The booking is confirmed only once the payment is captured (you will get an [event] payment_captured).",
    input: z.object({
      booking_id: bookingInput,
      first_name: z.string().max(80).optional().describe("The client's first name, only if they already gave it. Never ask for it: the payment page asks."),
      phone: z
        .string()
        .max(32)
        .optional()
        .describe("The client's mobile number, only if they volunteered it in this conversation (international format, e.g. +39 333 123 4567). Never ask for it."),
    }),
    run: async (input, c) => {
      const b = await scoped(c, input.booking_id);
      if (!b) return fail("not_found");
      // A phone that is not in international format is left for the payment page to collect: it never blocks the link.
      const phone = asE164(input.phone);
      const link = await createDepositLink(c.services, {
        bookingId: b.id,
        ...(input.first_name ? { firstName: input.first_name } : {}),
        ...(phone ? { phone } : {}),
      });
      if (!link.ok) return fail(link.error);
      if (link.value.confirmed) return ok({ booking_ref: b.ref, status: "confirmed", note: "Nothing to pay online: the booking is confirmed." });
      const after = await getBooking(c.services.db, b.id);
      return ok({
        booking_ref: b.ref,
        pay_url: link.value.payUrl,
        total_now: money(c, link.value.amountCents),
        ...(after?.holdExpiresAt ? { held_until: when(c, after.holdExpiresAt) } : {}),
        note: "Send pay_url to the client as it is. The booking is confirmed once PayPal captures the payment.",
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.listMyBookings,
    description: "This client's bookings (held, confirmed, past, cancelled) with booking_id, ref, time, status and amounts.",
    input: z.object({}),
    run: async (_input, c) => {
      const all = await conversationBookings(c.services, c.conversation);
      return ok({ bookings: all.filter((b) => b.status !== "expired").map((b) => describeBooking(b, c.pro, locale(c), { client: true })) });
    },
  }),

  tool({
    name: CLIENT_TOOLS.rescheduleBooking,
    description:
      "Moves one of this client's confirmed bookings to a start from get_availability (or the exact time the pro proposed). The deposit carries over. The pro's policy limits the client's own moves.",
    input: z.object({ booking_id: bookingInput, start: z.string().min(1).describe("The new start (ISO), from get_availability or the [event].") }),
    run: async (input, c) => {
      const b = await scoped(c, input.booking_id);
      if (!b) return fail("not_found");
      const proposal = await pendingProposal(c.services, b.id);
      const start = Date.parse(input.start);
      const by = proposal !== null && proposal === start && proposal !== b.start ? "pro" : "client";
      const moved = await rescheduleBooking(c.services, { bookingId: b.id, start: input.start, by });
      if (!moved.ok) return fail(moved.error);
      return ok({
        booking_ref: moved.value.ref,
        status: "confirmed",
        start: moved.value.start,
        local: when(c, Date.parse(moved.value.start)),
        previous_local: when(c, Date.parse(moved.value.movedFrom)),
        with: moved.value.staffName,
        deposit_carries_over: true,
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.cancelBooking,
    description:
      "Cancels one of this client's bookings under the pro's cancellation policy, in two steps. First call it with confirm false (the default): nothing changes, it returns exactly what would be refunded and kept, and why; tell the client and ask her to confirm. Only after she says yes in her NEXT message, call it again with confirm true: it cancels and runs the refund. A booking the pro could not keep (displaced) or a held, unpaid one is cancelled at once (full refund / simple release).",
    input: z.object({
      booking_id: bookingInput,
      confirm: z
        .boolean()
        .optional()
        .describe("false (default): preview only, nothing is cancelled. true: cancel now; only after the client confirmed the previewed outcome in a later message."),
      reason: z.string().max(200).optional(),
    }),
    run: async (input, c) => {
      const b = await scoped(c, input.booking_id);
      if (!b) return fail("not_found");
      const byPro = b.displacedAt !== null;
      // The client already chose the refund the [event] stated (pro could not keep it), or nothing was paid: no preview.
      const immediate = byPro || b.status === "held";
      if (!immediate) {
        const preview = await previewCancellation(c.services, { bookingId: b.id, by: "client" });
        if (!preview.ok) return fail(preview.error);
        const confirmed = input.confirm === true && (await previewedBefore(c, b.id, preview.value));
        if (!confirmed) {
          await logEvent(c.services, {
            kind: "system",
            name: "cancel_previewed",
            proId: c.pro.id,
            conversationId: c.conversation.id,
            bookingId: b.id,
            output: { refundCents: preview.value.refundCents, keptCents: preview.value.keptCents, feeKeptCents: preview.value.feeKeptCents },
          });
          c.turn?.previewed.add(b.id);
          return ok({
            booking_ref: b.ref,
            status: "not_cancelled_yet",
            if_cancelled: {
              refunded: money(c, preview.value.refundCents),
              deposit_kept: money(c, preview.value.keptCents),
              booking_fee_kept: money(c, preview.value.feeKeptCents),
              reason: outcomeReason(c, preview.value, false),
              policy: rulesText(b.policy, locale(c), b.currency).join(" "),
            },
            next:
              input.confirm === true
                ? "Nothing was cancelled: the client has not confirmed this exact outcome yet. Tell her what is refunded and kept, and ask her to confirm. Call cancel_booking with confirm true only after she says yes in her next message."
                : "Nothing was cancelled. Tell the client exactly what is refunded and kept, and ask her to confirm. Call cancel_booking with confirm true only after she says yes in her next message.",
          });
        }
      }
      const cancelled = await cancelBooking(c.services, { bookingId: b.id, by: byPro ? "pro" : "client", ...(input.reason ? { reason: input.reason } : {}) });
      if (!cancelled.ok) return fail(cancelled.error);
      const x = cancelled.value;
      if (x.released) return ok({ booking_ref: x.ref, status: "released", note: "The held time was released; nothing had been paid." });
      return ok({
        booking_ref: x.ref,
        status: "cancelled",
        refunded: money(c, x.refundCents),
        deposit_kept: money(c, x.keptCents),
        booking_fee_kept: money(c, x.feeKeptCents),
        refund_status: x.refundStatus,
        reason: outcomeReason(c, x, byPro),
        policy: rulesText(b.policy, locale(c), b.currency).join(" "),
      });
    },
  }),

  tool({
    name: CLIENT_TOOLS.declineProposedMove,
    description:
      "The client said no to the new time the pro proposed (reschedule_proposed): records her answer for the pro. The booking stays at its current time, nothing is paid or refunded.",
    input: z.object({ booking_id: bookingInput }),
    run: async (input, c) => {
      const b = await scoped(c, input.booking_id);
      if (!b) return fail("not_found");
      const declined = await declineProposal(c.services, { bookingId: b.id });
      if (!declined.ok) return fail(declined.error);
      return ok({ booking_ref: b.ref, status: "confirmed", stays_at: when(c, b.start), declined: when(c, Date.parse(declined.value.declinedStart)) });
    },
  }),

  tool({
    name: CLIENT_TOOLS.handoffToPro,
    description:
      "Passes the conversation to the pro herself (medical or allergy questions, complaints, custom requests, discounts or exceptions, anything no tool answers). She sees it in her dashboard and replies personally.",
    input: z.object({
      topic: z.enum(["medical", "complaint", "custom_request", "price_or_exception", "other"]),
      summary: z.string().min(1).max(500).describe("One or two sentences for the pro: what the client wants."),
    }),
    run: async (input, c) => {
      await logEvent(c.services, { kind: "system", name: "handoff", proId: c.pro.id, conversationId: c.conversation.id, input });
      return ok({ handed_off: true, note: `${c.pro.name} has the conversation and will reply personally.` });
    },
  }),
];
