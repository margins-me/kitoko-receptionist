import { err, ok } from "./result";
import type { Result } from "./result";
import type { QuoteLine, Selection, ServiceDef } from "./schemas";

export type Quote = { priceCents: number; minutes: number; lines: QuoteLine[] };

export function quote(
  service: ServiceDef,
  sel: Selection,
): Result<Quote, "conditions_not_accepted" | "missing_option" | "unknown_option" | "unknown_addon" | "invalid_total"> {
  if (service.conditions.length > 0 && !sel.conditionsAccepted) return err("conditions_not_accepted");
  const lines: QuoteLine[] = [
    {
      kind: "base",
      id: service.id,
      label: service.name,
      priceCents: service.basePriceCents,
      minutes: service.baseMinutes,
    },
  ];
  for (const group of service.optionGroups) {
    const chosen = sel.options[group.id] ?? group.default;
    if (chosen === undefined) return err("missing_option");
    const option = group.options.find((o) => o.id === chosen);
    if (!option) return err("unknown_option");
    lines.push({
      kind: "option",
      id: `${group.id}:${option.id}`,
      label: option.label,
      group: group.label,
      priceCents: option.priceCents,
      minutes: option.minutes,
    });
  }
  if (Object.keys(sel.options).some((key) => !service.optionGroups.some((g) => g.id === key))) {
    return err("unknown_option");
  }
  if (sel.addons.some((id) => !service.addons.some((a) => a.id === id))) return err("unknown_addon");
  for (const addon of service.addons) {
    if (!sel.addons.includes(addon.id)) continue;
    lines.push({ kind: "addon", id: addon.id, label: addon.label, priceCents: addon.priceCents, minutes: addon.minutes });
  }
  const priceCents = lines.reduce((sum, l) => sum + l.priceCents, 0);
  const minutes = lines.reduce((sum, l) => sum + l.minutes, 0);
  if (priceCents < 0 || minutes <= 0) return err("invalid_total");
  return ok({ priceCents, minutes, lines });
}

export function fromPrice(service: ServiceDef): { priceCents: number; minMinutes: number; maxMinutes: number } {
  let priceCents = service.basePriceCents;
  let minMinutes = service.baseMinutes;
  let maxMinutes = service.baseMinutes;
  for (const group of service.optionGroups) {
    priceCents += Math.min(...group.options.map((o) => o.priceCents));
    minMinutes += Math.min(...group.options.map((o) => o.minutes));
    maxMinutes += Math.max(...group.options.map((o) => o.minutes));
  }
  return { priceCents, minMinutes, maxMinutes };
}
