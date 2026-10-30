import type { PayActions, PayState } from "./types";

// Dev-only states for /pay/<anything>?fixture=held|held-fake|confirmed|expired|cancelled (the page refuses them in
// production). Fictional booking, Aïcha Braids in Milan.

export const FIXTURES = ["held", "held-fake", "confirmed", "expired", "cancelled"] as const;
export type Fixture = (typeof FIXTURES)[number];

export const isFixture = (value: unknown): value is Fixture => typeof value === "string" && (FIXTURES as readonly string[]).includes(value);

const base = (now: number): PayState["booking"] => {
  const start = new Date(now + 3 * 86_400_000);
  start.setUTCHours(9, 0, 0, 0);
  return {
    id: "fixture",
    ref: "K7Q2MX",
    status: "held",
    start: start.toISOString(),
    end: new Date(start.getTime() + 5 * 3_600_000).toISOString(),
    serviceName: "Knotless braids, mid-back",
    staffName: "Aïcha",
    proName: "Aïcha Braids",
    proHandle: "aicha.braids",
    city: "Milan",
    priceCents: 18000,
    depositCents: 5000,
    feeCents: 190,
    currency: "EUR",
    holdExpiresAt: new Date(now + 11 * 60_000 + 24_000).toISOString(),
    locale: "en",
    timeZone: "Europe/Rome",
  };
};

const POLICY =
  "Free cancellation up to 48 hours before: your deposit is refunded, the booking fee is kept. Later, or if you do not come, the deposit is kept.";

export function fixtureState(fixture: Fixture, now: number, clientId: string | null): PayState {
  const booking = base(now);
  const sandbox = fixture === "held" && clientId !== null;
  const paypal = { mode: sandbox ? "sandbox" : "fake", clientId: sandbox ? clientId : null } as const;
  switch (fixture) {
    case "held":
    case "held-fake":
      return { booking, payment: null, policyText: POLICY, client: { firstName: "Giulia", phone: null }, paypal };
    case "confirmed":
      return { booking: { ...booking, status: "confirmed", holdExpiresAt: null }, payment: { status: "captured", orderId: "FIXTURE-ORDER" }, policyText: POLICY, paypal };
    case "expired":
      return { booking: { ...booking, status: "expired", holdExpiresAt: new Date(now - 60_000).toISOString() }, payment: null, policyText: POLICY, paypal };
    case "cancelled":
      return { booking: { ...booking, status: "cancelled", holdExpiresAt: null }, payment: { status: "refunded", orderId: "FIXTURE-ORDER" }, policyText: POLICY, paypal };
  }
}

/** Local stand-ins for the server actions: the order resolves, the capture confirms the booking. */
export function fixtureActions(initial: PayState): PayActions {
  let state = initial;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    getPayState: async () => state,
    createPayPalOrder: async () => {
      await wait(400);
      return { ok: true, orderId: "FIXTURE-ORDER", approveUrl: "#fixture-approve" };
    },
    saveClientDetails: async () => {
      await wait(300);
      return { ok: true };
    },
    capturePayPalOrder: async () => {
      await wait(900);
      state = { ...state, booking: { ...state.booking, status: "confirmed", holdExpiresAt: null }, payment: { status: "captured", orderId: "FIXTURE-ORDER" } };
      return { ok: true, status: "COMPLETED" };
    },
  };
}
