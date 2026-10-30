import { Checkbox } from "../checkbox";
import { Chip, ChipGroup } from "../chip";
import { RadioRow, RadioRows } from "../radio-row";

// "Encaisser" (P05): how the balance is paid, then the tip (in hand) or whether the payment link offers one.
// Display-ready: the dashboard's booking panel wires the choices, the landing shows them still.

export type CollectMethod = "payment_link" | "cash" | "external";

export type CollectFieldsProps = {
  methods: { value: CollectMethod; label: string; hint: string }[];
  method: CollectMethod;
  onMethod?: (method: CollectMethod) => void;
  /** "Aucun", "5 €", "10 €", "15 €": value is the tip in cents. */
  tips: { value: number; label: string }[];
  tip: number;
  onTip?: (tip: number) => void;
  /** The payment link lets her client add a tip. */
  offerTip: boolean;
  onOfferTip?: (offer: boolean) => void;
  /** method, tip: the groups' legends; offerTip: the checkbox; linkExplain / recordExplain: the line under them. */
  labels: { method: string; tip: string; offerTip: string; linkExplain: string; recordExplain: string };
};

export function CollectFields({ methods, method, onMethod, tips, tip, onTip, offerTip, onOfferTip, labels }: CollectFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <RadioRows legend={labels.method} value={method} onValueChange={onMethod && ((value) => onMethod(value as CollectMethod))}>
        {methods.map((m) => (
          <RadioRow key={m.value} value={m.value} label={m.label} hint={m.hint} />
        ))}
      </RadioRows>
      {method === "payment_link" ? (
        <Checkbox checked={offerTip} readOnly={!onOfferTip} onChange={onOfferTip && ((e) => onOfferTip(e.target.checked))} label={labels.offerTip} />
      ) : (
        <ChipGroup legend={labels.tip} columns={4} value={String(tip)} onValueChange={onTip && ((value) => onTip(Number(value)))}>
          {tips.map((t) => (
            <Chip key={t.value} value={String(t.value)} label={t.label} />
          ))}
        </ChipGroup>
      )}
      <p className="text-sm text-muted">{method === "payment_link" ? labels.linkExplain : labels.recordExplain}</p>
    </div>
  );
}
