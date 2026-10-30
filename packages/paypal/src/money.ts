// Money crosses the PayPal boundary as decimal strings ("12.30"). Inside Kitoko it is integer cents. The conversions
// below split strings and build them from integers: no float arithmetic, so no 0.1 + 0.2 or 19.99 * 100 traps.

export const CURRENCIES = ["EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (c: unknown): c is Currency => c === "EUR" || c === "GBP";

/** PayPal's Orders, Payments, Invoicing and Reporting money object. */
export type PayPalMoney = { currency_code: Currency; value: string };

const isCents = (cents: number): boolean => Number.isSafeInteger(cents) && cents >= 0;

/** 1230 → "12.30". Throws on negative or non-integer cents: callers pass amounts computed from stored rows. */
export function centsToValue(cents: number): string {
  if (!isCents(cents)) throw new RangeError(`Invalid cents: ${cents}`);
  const units = Math.floor(cents / 100);
  const rest = cents - units * 100;
  return `${units}.${String(rest).padStart(2, "0")}`;
}

const VALUE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * "12.30" → 1230, "12.3" → 1230, "12" → 1200, "-5.00" → -500 (Reporting signs refunds and payouts).
 * Returns null for anything else, including more than two decimals: EUR and GBP have exactly two.
 */
export function valueToCents(value: string): number | null {
  const m = VALUE.exec(value.trim());
  if (!m) return null;
  const units = Number(m[2]);
  const fraction = Number((m[3] ?? "").padEnd(2, "0"));
  const cents = units * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

export function money(cents: number, currency: Currency): PayPalMoney {
  return { currency_code: currency, value: centsToValue(cents) };
}

/** A PayPal money object → cents and currency; null when the currency is not EUR/GBP or the value is malformed. */
export function fromMoney(m: { currency_code?: string; currency?: string; value: string } | undefined | null): { cents: number; currency: Currency } | null {
  if (!m) return null;
  const currency = m.currency_code ?? m.currency;
  if (!isCurrency(currency)) return null;
  const cents = valueToCents(m.value);
  return cents === null ? null : { cents, currency };
}
