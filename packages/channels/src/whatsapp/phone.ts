/** The Cloud API's recipient id: the E.164 number's digits, without the "+". */
export function toWaId(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** A WhatsApp id ("33612345678") as E.164 ("+33612345678"), the form the rest of the app stores. */
export function fromWaId(waId: string): string {
  return `+${toWaId(waId)}`;
}
