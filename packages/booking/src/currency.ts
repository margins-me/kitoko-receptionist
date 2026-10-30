import { z } from "zod";
import { intlLocale } from "./locale";
import type { Locale } from "./locale";

/** The currencies a pro charges in (pros.currency, bookings.currency): euros in Milan and Lyon, pounds in London. */
export const CURRENCIES = ["EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CurrencySchema = z.enum(CURRENCIES);

export const isCurrency = (value: unknown): value is Currency =>
  typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);

/**
 * "30 €", "4,90 €" (fr, it, es, pt), "€30", "£4.90" (en): whole amounts without decimals. The narrow symbol, so French
 * and Spanish write "30 £" rather than "30 £GB" or "30 GBP". Same output as the UI kit's formatMoney.
 */
export function formatMoney(cents: number, locale: Locale, currency: Currency): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}
