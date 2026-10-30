// A pro's trades, by the ids stored in pros.trades: the one list the dashboard setup, the public page and the demo CLI
// share. Pure.

/** Every trade the setup offers, in the order it shows them. "coiffure" is Soins et coupe. */
export const TRADES = ["tresses", "perruques", "ongles", "cils", "locks", "coiffure", "visage", "massage", "maquillage"] as const;
export type Trade = (typeof TRADES)[number];

export const isTrade = (value: unknown): value is Trade => typeof value === "string" && (TRADES as readonly string[]).includes(value);

/**
 * Hair or not, per trade. "coiffure" (Soins et coupe) and "perruques" count as hair; soins visage, massage & bien-être
 * and maquillage & sourcils do not.
 */
export const TRADE_KINDS: Record<Trade, "hair" | "other"> = {
  tresses: "hair",
  perruques: "hair",
  ongles: "other",
  cils: "other",
  locks: "hair",
  coiffure: "hair",
  visage: "other",
  massage: "other",
  maquillage: "other",
};

/**
 * The booking flow asks "Quelle coiffure ?" only when every trade she has is a hair trade: a pro who also does
 * make-up, facials or nails gets "Quelle prestation ?", true of all her services. An id that is not a trade here (an
 * old or later one) counts as not hair, so the flow falls back to its generic words rather than calling a facial a
 * "coiffure".
 */
export const hairOnly = (trades: readonly string[]): boolean => trades.length > 0 && trades.every((trade) => isTrade(trade) && TRADE_KINDS[trade] === "hair");
