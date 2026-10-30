import { err, ok } from "./result";
import type { Result } from "./result";
import type { DepositRule } from "./schemas";

/** The smallest amount charged online: below it, a payment costs more to process than it brings in. */
export const MINIMUM_CENTS = 50;

export function depositDue(priceCents: number, rule: DepositRule): number {
  switch (rule.mode) {
    case "none":
      return 0;
    case "fixed":
      return Math.min(rule.cents, priceCents);
    case "percent":
      return Math.floor((priceCents * rule.percent + 50) / 100);
    case "full":
      return priceCents;
  }
}

export function bookingFee(onlineCents: number): number {
  if (onlineCents <= 0) return 0;
  if (onlineCents <= 5000) return 150;
  if (onlineCents <= 10000) return 250;
  if (onlineCents <= 20000) return 390;
  return 550;
}

export function checkoutAmounts(i: {
  serviceCents: number;
  productsCents: number;
  deliveryCents: number;
  feePayer: "client" | "pro";
}): Result<
  { baseCents: number; feeCents: number; chargeCents: number; platformFeeCents: number; proReceivesCents: number },
  "below_fee" | "below_minimum"
> {
  const baseCents = i.serviceCents + i.productsCents + i.deliveryCents;
  const feeCents = bookingFee(baseCents);
  const chargeCents = i.feePayer === "client" ? baseCents + feeCents : baseCents;
  const proReceivesCents = i.feePayer === "client" ? baseCents : baseCents - feeCents;
  if (baseCents > 0 && i.feePayer === "pro" && baseCents <= feeCents) return err("below_fee");
  if (chargeCents > 0 && chargeCents < MINIMUM_CENTS) return err("below_minimum");
  return ok({ baseCents, feeCents, chargeCents, platformFeeCents: feeCents, proReceivesCents });
}

export function balanceDue(priceCents: number, paidServiceCents: number): number {
  return Math.max(priceCents - paidServiceCents, 0);
}

/** A pro's promo code (public.promo_codes): exactly one of a percent or a fixed amount off the service price. */
export type Promo = { percent: number | null; cents: number | null };

/** The amount a promo code takes off this price, never more than the price. */
export function promoDiscount(priceCents: number, promo: Promo): number {
  const off = promo.percent !== null ? Math.floor((priceCents * promo.percent + 50) / 100) : (promo.cents ?? 0);
  return Math.max(0, Math.min(off, priceCents));
}

/**
 * A booking's amounts with a promo code (null removes it): the discount comes off the list price, then the
 * deposit follows the new price. Refused when that deposit could not be paid online (see checkoutAmounts).
 */
export function promoQuote(i: {
  listPriceCents: number;
  promo: Promo | null;
  deposit: DepositRule;
  feePayer: "client" | "pro";
}): Result<{ priceCents: number; depositCents: number; discountCents: number }, "below_fee" | "below_minimum"> {
  const discountCents = i.promo ? promoDiscount(i.listPriceCents, i.promo) : 0;
  const priceCents = i.listPriceCents - discountCents;
  const depositCents = depositDue(priceCents, i.deposit);
  const amounts = checkoutAmounts({ serviceCents: depositCents, productsCents: 0, deliveryCents: 0, feePayer: i.feePayer });
  if (!amounts.ok) return amounts;
  return ok({ priceCents, depositCents, discountCents });
}
