import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client";
import { captureOrder, createOrder, getOrder, paypalLocale } from "../src/orders";
import { ENV, approvedOrder, orderInput, setup } from "./helpers";

describe("createOrder", () => {
  it("fake PayPal: the approval link stays on the app the buyer came from (any dev port)", async () => {
    const s = setup();
    const res = await createOrder({ ...orderInput, returnUrl: "http://localhost:3301/pay/b1/return", cancelUrl: "http://localhost:3301/pay/b1?cancelled=1" }, s.client);
    expect(res.ok && res.value.approveUrl).toBe(`http://localhost:3301/pay/fake-approve?token=${res.ok ? res.value.orderId : ""}`);
    const approved = s.fake.approve(res.ok ? res.value.orderId : "");
    expect(approved?.returnUrl).toMatch(/^http:\/\/localhost:3301\/pay\/b1\/return\?token=/);
  });

  it("sends one purchase unit with deposit + fee items and the PayPal wallet experience", async () => {
    const s = setup();
    const res = await createOrder(orderInput, s.client);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("PAYER_ACTION_REQUIRED");
    expect(res.value.approveUrl).toBe(`http://localhost:3300/pay/fake-approve?token=${res.value.orderId}`);

    const body = s.posts()[0]!.body;
    expect(body).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "K7Q2ZP",
          custom_id: orderInput.bookingId,
          invoice_id: "K7Q2ZP-pay-0001",
          description: orderInput.description,
          amount: { currency_code: "EUR", value: "31.50", breakdown: { item_total: { currency_code: "EUR", value: "31.50" } } },
          items: [
            { name: "Acompte", quantity: "1", unit_amount: { currency_code: "EUR", value: "30.00" } },
            { name: "Frais de réservation", quantity: "1", unit_amount: { currency_code: "EUR", value: "1.50" } },
          ],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Kitoko",
            locale: "fr-FR",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            landing_page: "NO_PREFERENCE",
            return_url: orderInput.returnUrl,
            cancel_url: orderInput.cancelUrl,
          },
        },
      },
    });
  });

  it("drops the fee line when there is no fee and names items in English for en", async () => {
    const s = setup();
    await createOrder({ ...orderInput, feeCents: 0, locale: "en", currency: "GBP" }, s.client);
    const unit = (s.posts()[0]!.body as { purchase_units: { items: unknown[]; amount: { value: string } }[] }).purchase_units[0]!;
    expect(unit.items).toEqual([{ name: "Deposit", quantity: "1", unit_amount: { currency_code: "GBP", value: "30.00" } }]);
    expect(unit.amount.value).toBe("30.00");
  });

  it("refuses bad amounts and currencies without calling PayPal", async () => {
    const s = setup();
    expect((await createOrder({ ...orderInput, depositCents: 0 }, s.client)).ok).toBe(false);
    expect((await createOrder({ ...orderInput, feeCents: 1.5 }, s.client)).ok).toBe(false);
    expect((await createOrder({ ...orderInput, currency: "USD" as "EUR" }, s.client)).ok).toBe(false);
    expect(s.fake.requests).toHaveLength(0);
  });

  it("maps app locales to PayPal locales", () => {
    expect(paypalLocale("fr")).toBe("fr-FR");
    expect(paypalLocale("en")).toBe("en-GB");
    expect(paypalLocale("pt")).toBe("pt-PT");
    expect(paypalLocale("en-US")).toBe("en-US");
    expect(paypalLocale("xx")).toBeUndefined();
  });
});

describe("approve → capture", () => {
  it("captures an approved order and reads back the payer", async () => {
    const s = setup();
    const created = await createOrder(orderInput, s.client);
    if (!created.ok) throw new Error("create failed");
    const orderId = created.value.orderId;

    const approval = s.fake.approve(orderId, { givenName: "Awa", surname: "Diallo", email: "awa@example.com", payerId: "PAYER123" });
    expect(approval?.returnUrl).toBe(`${orderInput.returnUrl}?token=${orderId}&PayerID=PAYER123`);

    const captured = await captureOrder({ orderId }, s.client);
    expect(captured).toEqual({
      ok: true,
      value: {
        orderId,
        status: "COMPLETED",
        captureId: expect.stringMatching(/^FKCAP/),
        amountCents: 3150,
        currency: "EUR",
        customId: orderInput.bookingId,
        pendingReason: null,
        payer: { name: "Awa Diallo", email: "awa@example.com", payerId: "PAYER123" },
        alreadyCaptured: false,
      },
    });
    const capturePost = s.posts()[1]!;
    expect(capturePost.headers.prefer).toBe("return=representation");

    const order = await getOrder(orderId, s.client);
    expect(order.ok && order.value).toMatchObject({ status: "COMPLETED", customId: orderInput.bookingId, amountCents: 3150, capture: { status: "COMPLETED" } });
  });

  it("replays the same capture for the same request id and recovers ORDER_ALREADY_CAPTURED for another", async () => {
    const s = setup();
    const orderId = await approvedOrder(s);
    const first = await captureOrder({ orderId }, s.client);
    const replay = await captureOrder({ orderId }, s.client);
    const other = await captureOrder({ orderId, requestId: "webhook-backstop" }, s.client);
    if (!first.ok || !replay.ok || !other.ok) throw new Error("capture failed");
    expect(replay.value).toEqual(first.value);
    expect(other.value).toMatchObject({ captureId: first.value.captureId, amountCents: 3150, alreadyCaptured: true });
  });

  it("refuses to capture before approval", async () => {
    const s = setup();
    const created = await createOrder(orderInput, s.client);
    if (!created.ok) throw new Error("create failed");
    const res = await captureOrder({ orderId: created.value.orderId }, s.client);
    expect(res).toMatchObject({ ok: false, error: { code: "unprocessable", status: 422, issue: "ORDER_NOT_APPROVED" } });
  });

  it("maps INSTRUMENT_DECLINED to declined; the buyer can approve again", async () => {
    const s = setup();
    const orderId = await approvedOrder(s);
    s.fake.setCaptureOutcome(orderId, "declined");
    const res = await captureOrder({ orderId, requestId: "cap-1" }, s.client);
    expect(res).toMatchObject({ ok: false, error: { code: "declined", status: 422, issue: "INSTRUMENT_DECLINED", retryable: false } });
    expect(!res.ok && res.error.debugId).toMatch(/^fakedebug/);

    expect(s.fake.approve(orderId)).not.toBeNull();
    const retry = await captureOrder({ orderId, requestId: "cap-2" }, s.client);
    expect(retry.ok && retry.value.status).toBe("COMPLETED");
  });

  it("maps PayPal's real 422 INSTRUMENT_DECLINED body", async () => {
    const body = {
      name: "UNPROCESSABLE_ENTITY",
      details: [
        {
          issue: "INSTRUMENT_DECLINED",
          description: "The instrument presented  was either declined by the processor or bank, or it can't be used for this payment.",
        },
      ],
      message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
      debug_id: "c9a75b43fc807",
      links: [
        { href: "https://developer.paypal.com/docs/api/orders/v2/#error-INSTRUMENT_DECLINED", rel: "information_link", method: "GET" },
        { href: "https://www.sandbox.paypal.com/checkoutnow?token=1KC5501443316171H", rel: "redirect", method: "GET" },
      ],
    };
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/oauth2/token")
        ? new Response(JSON.stringify({ access_token: "T", expires_in: 32400 }), { status: 200 })
        : new Response(JSON.stringify(body), { status: 422, headers: { "paypal-debug-id": "c9a75b43fc807" } }),
    );
    const client = createClient({ fetch: fetch as unknown as typeof globalThis.fetch, env: ENV, now: Date.now });
    const res = await captureOrder({ orderId: "1KC5501443316171H" }, client);
    expect(res).toEqual({
      ok: false,
      error: { code: "declined", status: 422, issue: "INSTRUMENT_DECLINED", message: body.details[0]!.description, debugId: "c9a75b43fc807", retryable: false },
    });
  });

  it("returns a PENDING capture with its reason", async () => {
    const s = setup();
    const orderId = await approvedOrder(s);
    s.fake.setCaptureOutcome(orderId, "pending");
    const res = await captureOrder({ orderId }, s.client);
    expect(res.ok && res.value).toMatchObject({ status: "PENDING", pendingReason: "PENDING_REVIEW" });
  });

  it("maps an unknown order to not_found", async () => {
    const s = setup();
    expect(await getOrder("NOPE", s.client)).toMatchObject({ ok: false, error: { code: "not_found", status: 404 } });
  });
});
