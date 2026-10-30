// The deposit page's data, as `getPayState` (src/app/[locale]/pay/[id]/actions.ts) returns it. Kept here, loosely
// typed (dates as ISO strings, numbers or Dates; statuses as strings), so the page reads whatever the server sends.

export type When = string | number | Date;

export type PayBooking = {
  id: string;
  ref: string;
  status: string;
  start: When;
  end: When;
  serviceName: string;
  staffName: string | null;
  proName: string;
  proHandle: string;
  city: string | null;
  priceCents: number;
  depositCents: number;
  feeCents: number;
  currency: string;
  holdExpiresAt: When | null;
  locale: string;
  /** The pro's IANA time zone, when the server sends it; else guessed from the currency. */
  timeZone?: string | null;
};

export type PayState = {
  booking: PayBooking;
  payment: { status: string; orderId: string | null } | null;
  policyText: string | null;
  /** Who the booking is for, as far as the server knows (prefills "Your details"); null once it is not held. */
  client?: { firstName: string | null; phone: string | null } | null;
  paypal: { mode: "sandbox" | "fake"; clientId: string | null };
};

export type CreateOrderResult = { ok: true; orderId: string; approveUrl: string } | { ok: false; error: string };
export type CaptureResult = { ok: true; status: string } | { ok: false; error: string };
export type SaveDetailsResult = { ok: true } | { ok: false; error: string };

/** The server actions the page calls (or their fixtures). */
export type PayActions = {
  getPayState: (bookingId: string) => Promise<PayState | null>;
  createPayPalOrder: (bookingId: string) => Promise<CreateOrderResult>;
  capturePayPalOrder: (bookingId: string, orderId: string) => Promise<CaptureResult>;
  saveClientDetails: (bookingId: string, details: { firstName: string; phone?: string | null }) => Promise<SaveDetailsResult>;
};

/** What the page shows. */
export type PayView = "held" | "confirmed" | "expired" | "cancelled";
