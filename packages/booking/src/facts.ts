// What the facts line under her name may say about booking with her. Pure: the public page, the dashboard's
// previews and the tests share it.
import { effectiveDepositRule } from "./deposit-rule";
import type { DepositRule, Rules } from "./schemas";

/** Keys of the page's `facts.*` messages, in the order they are shown. */
export type BookingFact = "anytime" | "instant" | "deposit" | "payment";

const DEPOSIT: ReadonlySet<DepositRule["mode"]> = new Set(["fixed", "percent"]);

/**
 * Each fact only when it holds for every service she offers:
 * - anytime, "Réservation 24h/24": she has a service online; the page takes bookings at any hour.
 * - instant, "Confirmation immédiate": a booking made on the page is confirmed by its checkout (held, then
 *   confirmed); there is no step where she approves it (awaiting_deposit is only for bookings she makes herself).
 * - deposit, "Acompte en ligne": her payments are on and every service takes a deposit (fixed or percent) online.
 * - payment, "Paiement en ligne": the same, where some service is paid in full at booking.
 * Payments off means no deposit at all (effectiveDepositRule): nothing is said about paying then.
 */
export function bookingFacts(
  services: readonly { deposit: DepositRule | null }[],
  rules: Pick<Rules, "deposit">,
  paymentsEnabled: boolean,
): BookingFact[] {
  if (services.length === 0) return [];
  const modes = services.map((s) => effectiveDepositRule(s.deposit, rules, paymentsEnabled).mode);
  const paid = modes.every((mode) => DEPOSIT.has(mode) || mode === "full");
  return ["anytime", "instant", ...(paid ? [modes.every((mode) => DEPOSIT.has(mode)) ? ("deposit" as const) : ("payment" as const)] : [])];
}
