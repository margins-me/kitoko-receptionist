import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createClient, defaultDeps } from "../src/client";
import { createAndSendInvoice } from "../src/invoices";
import { captureOrder, createOrder } from "../src/orders";
import { createPayout } from "../src/payouts";
import { refundCapture } from "../src/refunds";
import { verifyWebhook } from "../src/webhooks";
import { ENV, approvedOrder, orderInput, setup } from "./helpers";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const tokenResponse = () => json(200, { access_token: "T", token_type: "Bearer", expires_in: 32400 });
const anything = z.looseObject({});

/** A fetch stub: the OAuth call answers a token, other calls are answered in order by `responses`. */
function stub(responses: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/v1/oauth2/token")) return tokenResponse();
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, api: () => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token")) };
}

describe("OAuth token", () => {
  it("is fetched once with Basic auth and cached until shortly before expires_in", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) await createOrder({ ...orderInput, requestId: `pay-${i}` }, s.client);
    const tokenCalls = () => s.fake.requests.filter((r) => r.path === "/v1/oauth2/token");
    expect(tokenCalls()).toHaveLength(1);
    expect(tokenCalls()[0]!.headers.authorization).toBe(`Basic ${btoa("client-id:client-secret")}`);
    expect(tokenCalls()[0]!.body).toBe("grant_type=client_credentials");

    s.tick((32400 - 61) * 1000); // still inside expires_in − 60 s
    await createOrder({ ...orderInput, requestId: "pay-a" }, s.client);
    expect(tokenCalls()).toHaveLength(1);

    s.tick(2000); // past it
    await createOrder({ ...orderInput, requestId: "pay-b" }, s.client);
    expect(tokenCalls()).toHaveLength(2);
  });

  it("is shared by concurrent first calls", async () => {
    const s = setup();
    await Promise.all([1, 2, 3].map((i) => createOrder({ ...orderInput, requestId: `pay-${i}` }, s.client)));
    expect(s.fake.requests.filter((r) => r.path === "/v1/oauth2/token")).toHaveLength(1);
  });

  it("is renewed once when PayPal answers 401", async () => {
    const s = setup();
    await createOrder(orderInput, s.client);
    s.fake.expireTokens();
    const again = await createOrder({ ...orderInput, requestId: "pay-2" }, s.client);
    expect(again.ok).toBe(true);
    expect(s.fake.requests.filter((r) => r.path === "/v1/oauth2/token")).toHaveLength(2);
  });

  it("reports missing credentials as auth without any HTTP call", async () => {
    const fetch = vi.fn();
    const client = createClient({ fetch: fetch as unknown as typeof globalThis.fetch, env: { PAYPAL_ENV: "sandbox" }, now: Date.now });
    const res = await createOrder(orderInput, client);
    expect(res).toMatchObject({ ok: false, error: { code: "auth" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a rejected client secret to auth", async () => {
    const fetch = vi.fn(async () => json(401, { error: "invalid_client", error_description: "Client Authentication failed" }));
    const client = createClient({ fetch: fetch as unknown as typeof globalThis.fetch, env: ENV, now: Date.now, sleep: async () => undefined });
    const res = await createOrder(orderInput, client);
    expect(res).toMatchObject({ ok: false, error: { code: "auth", issue: "invalid_client", message: "Client Authentication failed" } });
  });
});

describe("PayPal-Request-Id", () => {
  it("is sent on every POST of every module", async () => {
    const s = setup();
    const orderId = await approvedOrder(s);
    const captured = await captureOrder({ orderId }, s.client);
    if (!captured.ok) throw new Error(captured.error.message);
    await refundCapture({ captureId: captured.value.captureId, amountCents: 1000, currency: "EUR", reason: "Annulation", requestId: "refund-1" }, s.client);
    await createPayout({ senderBatchId: "payout-1", items: [{ receiver: "pro@example.com", amountCents: 2000, currency: "EUR", note: "K7Q2ZP", senderItemId: "payout-1" }] }, s.client);
    await createAndSendInvoice(
      { recipientEmail: "c@example.com", recipientName: "Ada Lovelace", items: [{ name: "Solde", amountCents: 6000 }], currency: "EUR", note: "Merci", reference: "K7Q2ZP", requestId: "inv-1" },
      s.client,
    );
    const event = JSON.stringify(s.fake.events[0]);
    await verifyWebhook({ headers: transmissionHeaders, body: event }, s.client);

    const posts = s.posts();
    expect(posts.map((p) => p.path)).toEqual([
      "/v2/checkout/orders",
      `/v2/checkout/orders/${orderId}/capture`,
      `/v2/payments/captures/${captured.value.captureId}/refund`,
      "/v1/payments/payouts",
      "/v2/invoicing/invoices",
      expect.stringMatching(/^\/v2\/invoicing\/invoices\/INV2-FAKE-\d+\/send$/),
      "/v1/notifications/verify-webhook-signature",
    ]);
    for (const p of posts) expect(p.headers["paypal-request-id"], p.path).toBeTruthy();
    expect(posts.map((p) => p.headers["paypal-request-id"])).toEqual([
      "pay-0001",
      `capture-${orderId}`,
      "refund-1",
      "payout-1",
      "inv-1",
      "inv-1-send",
      "verify-tx-1",
    ]);
  });

  it("is refused when empty, before any HTTP call", async () => {
    const s = setup();
    const res = await createOrder({ ...orderInput, requestId: " " }, s.client);
    expect(res).toMatchObject({ ok: false, error: { code: "unprocessable" } });
    expect(s.posts()).toHaveLength(0);
  });

  it("replays the first answer: the same create twice gives the same order", async () => {
    const s = setup();
    const a = await createOrder(orderInput, s.client);
    const b = await createOrder(orderInput, s.client);
    expect(a.ok && b.ok && a.value.orderId === b.value.orderId).toBe(true);
  });
});

const transmissionHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "c2lnbmF0dXJl",
  "paypal-transmission-time": "2026-10-27T10:00:00Z",
};

describe("retries and errors", () => {
  it("retries 5xx and 429 up to twice with the same request id", async () => {
    const st = stub([() => json(503, {}), () => json(429, {}, { "retry-after": "1" }), () => json(201, { id: "O1", status: "PAYER_ACTION_REQUIRED" })]);
    const sleeps: number[] = [];
    const client = createClient({ fetch: st.fetch, env: ENV, now: Date.now, sleep: async (ms) => void sleeps.push(ms) });
    const res = await client.request({ method: "POST", path: "/v2/checkout/orders", requestId: "rq-1", body: {} }, anything);
    expect(res.ok).toBe(true);
    expect(st.api()).toHaveLength(3);
    expect(new Set(st.api().map((c) => (c.init.headers as Record<string, string>)["PayPal-Request-Id"]))).toEqual(new Set(["rq-1"]));
    expect(sleeps).toEqual([300, 1000]);
  });

  it("gives up after 2 retries with a retryable error and the debug id", async () => {
    const st = stub([0, 1, 2].map(() => () => json(500, { name: "INTERNAL_SERVER_ERROR", message: "boom", debug_id: "body-dbg" }, { "paypal-debug-id": "hdr-dbg" })));
    const client = createClient({ fetch: st.fetch, env: ENV, now: Date.now, sleep: async () => undefined });
    const res = await client.request({ method: "GET", path: "/v2/checkout/orders/X" }, anything);
    expect(res).toEqual({
      ok: false,
      error: { code: "unknown", status: 500, issue: "INTERNAL_SERVER_ERROR", message: "boom", debugId: "hdr-dbg", retryable: true },
    });
    expect(st.api()).toHaveLength(3);
  });

  it("maps network failures to network after retries", async () => {
    const st = stub([0, 1, 2].map(() => () => Promise.reject(new TypeError("fetch failed"))));
    const client = createClient({ fetch: st.fetch, env: ENV, now: Date.now, sleep: async () => undefined });
    const res = await client.request({ method: "GET", path: "/v2/checkout/orders/X" }, anything);
    expect(res).toMatchObject({ ok: false, error: { code: "network", status: null, message: "fetch failed", retryable: true } });
  });

  it("does not retry 4xx and maps 404 to not_found", async () => {
    const st = stub([
      () =>
        json(
          404,
          { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID", description: "Specified resource ID does not exist." }], debug_id: "dbg404" },
        ),
    ]);
    const client = createClient({ fetch: st.fetch, env: ENV, now: Date.now, sleep: async () => undefined });
    const res = await client.request({ method: "GET", path: "/v2/checkout/orders/NOPE" }, anything);
    expect(res).toMatchObject({ ok: false, error: { code: "not_found", issue: "INVALID_RESOURCE_ID", debugId: "dbg404", retryable: false } });
    expect(st.api()).toHaveLength(1);
  });

  it("reports an unexpected success body as unknown instead of throwing", async () => {
    const st = stub([() => json(200, { nope: true })]);
    const client = createClient({ fetch: st.fetch, env: ENV, now: Date.now, sleep: async () => undefined });
    const res = await client.request({ method: "GET", path: "/x" }, z.object({ id: z.string() }));
    expect(res).toMatchObject({ ok: false, error: { code: "unknown", issue: "UNEXPECTED_RESPONSE" } });
  });
});

describe("PAYPAL_ENV=fake", () => {
  it("routes the default deps to the shared fake and points approval at the dev route", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3300");
    const client = createClient(defaultDeps({ PAYPAL_ENV: "fake" }));
    const res = await createOrder(orderInput, client);
    expect(res.ok && res.value.approveUrl).toMatch(/^http:\/\/localhost:3300\/pay\/fake-approve\?token=FKORD\d+$/);
    vi.unstubAllEnvs();
  });
});
