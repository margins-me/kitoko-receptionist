const RANGE = /^\[([^,]+),([^,]+)\)$/;
const TIMESTAMP = /^"?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2})(:\d{2})?"?$/;

function toEpoch(bound: string): number {
  const m = TIMESTAMP.exec(bound);
  // Postgres prints offsets as "+00", which Date.parse rejects.
  const at = m ? Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4] ?? (m[3] === "Z" ? "" : ":00")}`) : NaN;
  if (Number.isNaN(at)) throw new Error(`Invalid range bound: ${bound}`);
  return at;
}

/** A tstzrange as Postgres prints it, "[start,end)", to epoch milliseconds. */
export function parseRange(text: string): { start: number; end: number } {
  const m = RANGE.exec(text);
  if (!m) throw new Error(`Expected a finite [start,end) range, got: ${text}`);
  return { start: toEpoch(m[1]!), end: toEpoch(m[2]!) };
}

/** Epoch milliseconds to a tstzrange literal. */
export function formatRange(start: number, end: number): string {
  return `[${new Date(start).toISOString()},${new Date(end).toISOString()})`;
}
