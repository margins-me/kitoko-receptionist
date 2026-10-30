// Postgres error codes that callers expect, mapped to the app's error names.
// Custom codes (KTxxx) are raised by the functions in supabase/migrations.
const DB_ERRORS = {
  "42501": "forbidden",
  "22023": "invalid_argument",
  "23P01": "slot_taken",
  KT001: "slot_blocked",
  KT002: "slot_booked",
  KT003: "not_held",
  KT005: "too_many_holds",
  KT006: "not_reschedulable",
  KT007: "not_cancellable",
  KT011: "not_payable",
  KT012: "exceeds_balance",
  KT018: "not_markable",
  KT030: "staff_not_eligible",
  KT031: "amount_mismatch",
  KT032: "not_pending",
  KT033: "not_refundable",
  P0002: "not_found",
} as const;

export type DbErrors = typeof DB_ERRORS;
export type DbErrorCode = keyof DbErrors;
export type DbErrorName = DbErrors[DbErrorCode];

/** Maps an error whose code is one of `codes` to its name; rethrows anything else, as a bug. */
export function dbError<C extends DbErrorCode>(error: { code: string }, codes: readonly C[]): DbErrors[C] {
  const code = codes.find((c) => c === error.code);
  if (code === undefined) throw error;
  return DB_ERRORS[code];
}
