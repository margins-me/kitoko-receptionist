import { getFakePayPal } from "@kitoko/paypal";
import { getOrCreateConversation, listMessages, resetDemo } from "@kitoko/db";
import { findSlots, holdSlot } from "../src/services/booking";
import { capturePayment, createDepositLink } from "../src/services/payments";
import { createServicesCtx } from "../src/services/ctx";
import type { OutboundMessage, ServicesCtx } from "../src/services/ctx";

export const AICHA = "a0000000-0000-4000-8000-000000000003";
export const KEMI = "a0000000-0000-4000-8000-000000000002";
export const KEMI_GEL = "b0000000-0000-4000-8000-000000000021";
export const DAY = 86_400_000;

/** A services context on the local stack, fake PayPal, fake model; WhatsApp messages are collected, not sent. */
export function testCtx(overrides: Partial<ServicesCtx> = {}): ServicesCtx & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  const ctx = createServicesCtx(process.env, {
    deliver: async (msg) => {
      sent.push(msg);
      return { ok: true, providerId: null };
    },
    ...overrides,
  });
  return Object.assign(ctx, { sent });
}

export const fakePayPal = () => getFakePayPal();

export async function newWebConversation(ctx: ServicesCtx, proId: string) {
  return getOrCreateConversation(ctx.db, { proId, kind: "client", channel: "web", locale: "en" });
}

export async function reset(ctx: ServicesCtx, proId: string) {
  const r = await resetDemo(ctx.db, proId);
  if (!r.ok) throw new Error(r.error);
}

export const texts = async (ctx: ServicesCtx, conversationId: string) =>
  (await listMessages(ctx.db, conversationId)).map((m) => ({ role: m.role, visible: m.visible, content: JSON.stringify(m.content) }));

/** Holds the first free Kemi gel slot from `days` days out, in a new web conversation. */
export async function heldBooking(ctx: ServicesCtx, days: number) {
  const conversation = await newWebConversation(ctx, KEMI);
  const from = Date.now() + days * DAY;
  const slots = await findSlots(ctx, { proId: KEMI, serviceId: KEMI_GEL, from, to: from + 7 * DAY });
  if (!slots.ok || !slots.value[0]) throw new Error(`no slot: ${JSON.stringify(slots)}`);
  const held = await holdSlot(ctx, { proId: KEMI, serviceId: KEMI_GEL, start: slots.value[0].start, source: "web", conversationId: conversation.id, locale: "en" });
  if (!held.ok) throw new Error(held.error);
  return { conversation, held: held.value };
}

/** Deposit link, buyer approval on the fake PayPal, capture. */
export async function payDeposit(ctx: ServicesCtx, bookingId: string, who: { firstName?: string; email?: string } = { firstName: "Tolu" }) {
  const link = await createDepositLink(ctx, { bookingId, ...who });
  if (!link.ok || !link.value.orderId) throw new Error(JSON.stringify(link));
  if (!getFakePayPal().approve(link.value.orderId)) throw new Error("fake approve failed");
  const captured = await capturePayment(ctx, { orderId: link.value.orderId });
  if (!captured.ok) throw new Error(captured.error);
  return { link: link.value, captured: captured.value };
}
