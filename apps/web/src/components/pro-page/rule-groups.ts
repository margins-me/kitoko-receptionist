import { pickText } from "@kitoko/booking/locale";
import type { Locale } from "@kitoko/booking/locale";
import type { Currency, Rules } from "@kitoko/booking";
import { rulesText } from "@kitoko/booking/rules-text";

/**
 * Her rule sentences (rulesText) for the Infos tab's two rows: "Deposit and cancellation" (deposit, rescheduling,
 * cancellation) and "Lateness / Good to know" (lateness, coming alone, her own notes). rulesText lists them in that
 * order; the second group's length is known from the rules, so the list is cut there.
 */
export function ruleGroups(rules: Rules, locale: Locale, currency: Currency): { policy: string[]; onTheDay: string[] } {
  const all = rulesText(rules, locale, currency);
  const { feeCents, autoCancelAfterMinutes } = rules.lateness;
  const lateness = 1 + (feeCents !== null && feeCents > 0 ? 1 : 0) + (autoCancelAfterMinutes !== null ? 1 : 0);
  const notes = rules.extra.filter((text) => pickText(text, locale).trim().length > 0).length;
  const cut = all.length - (lateness + (rules.companionsAllowed ? 0 : 1) + notes);
  return { policy: all.slice(0, cut), onTheDay: all.slice(cut) };
}
