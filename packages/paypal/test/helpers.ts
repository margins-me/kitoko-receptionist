import { createClient } from "../src/client";
import { createFakePayPal } from "../src/fake";
import type { FakePayPal } from "../src/fake";

export const ENV = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_CLIENT_SECRET: "client-secret",
  PAYPAL_WEBHOOK_ID: "WH-ID-1",
  SITE_URL: "http://localhost:3300",
};

/** A client wired to a fresh fake PayPal, with a controllable clock and no retry delays. */
export function setup(env: Record<string, string | undefined> = ENV) {
  let clock = Date.parse("2026-10-27T10:00:00Z");
  const fake: FakePayPal = createFakePayPal({ siteUrl: "http://localhost:3300", now: () => clock });
  const client = createClient({ fetch: fake.fetch, env, now: () => clock, sleep: async () => undefined });
  return {
    fake,
    client,
    tick: (ms: number) => {
      clock += ms;
    },
    posts: () => fake.requests.filter((r) => r.method === "POST" && r.path !== "/v1/oauth2/token"),
  };
}

export const orderInput = {
  bookingId: "b0b0b0b0-0000-4000-8000-000000000001",
  ref: "K7Q2ZP",
  description: "Box braids, Fri 31 Oct 10:00, Amara Studio",
  currency: "EUR" as const,
  depositCents: 3000,
  feeCents: 150,
  returnUrl: "http://localhost:3300/pay/b0b0/return",
  cancelUrl: "http://localhost:3300/pay/b0b0/cancel",
  locale: "fr",
  requestId: "pay-0001",
};

/** Create an order on the fake and approve it as the buyer. */
export async function approvedOrder(s: ReturnType<typeof setup>, input = orderInput) {
  const { createOrder } = await import("../src/orders");
  const created = await createOrder(input, s.client);
  if (!created.ok) throw new Error(created.error.message);
  s.fake.approve(created.value.orderId);
  return created.value.orderId;
}
