/**
 * Server events reach the agent as hidden user messages ("[event] payment_captured {…}", stored with visible=false);
 * the agent then writes what the client or the pro should read. The prompts describe how to answer each kind below.
 */
export const SYSTEM_EVENT_PREFIX = "[event]";

export type SystemEventKind =
  /** The deposit was captured: the booking is confirmed. */
  | "payment_captured"
  /** A sick-day block displaced a confirmed booking. Data should list alternative slots. */
  | "booking_displaced"
  /** The pro dragged a booking in the calendar: the client must accept the new time. */
  | "reschedule_proposed";

/** "[event] payment_captured {"booking_ref":"K7X2PQ",…}": compact JSON so the model reads every field. */
export function systemEvent(kind: SystemEventKind | (string & {}), data?: Record<string, unknown>): string {
  return data === undefined ? `${SYSTEM_EVENT_PREFIX} ${kind}` : `${SYSTEM_EVENT_PREFIX} ${kind} ${JSON.stringify(data)}`;
}

export const isSystemEvent = (text: string): boolean => text.startsWith(SYSTEM_EVENT_PREFIX);
