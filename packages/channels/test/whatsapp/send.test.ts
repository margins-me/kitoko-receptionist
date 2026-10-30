import { afterEach, describe, expect, it, vi } from "vitest";
import { toButtonsPayload, toCloudApiPayload, toTextPayload } from "../../src/whatsapp/render";
import { sendButtons, sendTemplate, sendText } from "../../src/whatsapp/send";
import type { TemplateVars } from "../../src/whatsapp/templates";

const vars: TemplateVars<"review_request"> = { firstName: "Awa", proName: "Nala Braids", manageToken: "tok_123" };
const msg = { to: "+33612345678", name: "review_request" as const, locale: "fr" as const, vars };
const cloudEnv = { WHATSAPP_TRANSPORT: "cloud", WHATSAPP_PHONE_NUMBER_ID: "1234567890", WHATSAPP_ACCESS_TOKEN: "test-token" };
const buttons = [
  { id: "confirm:pa_1", title: "Confirm" },
  { id: "cancel:pa_1", title: "Cancel" },
];

const reply = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body, { status }));
const sentBody = (f: ReturnType<typeof reply>) => JSON.parse(String(f.mock.calls[0]?.[1]?.body)) as unknown;

afterEach(() => vi.restoreAllMocks());

describe("log transport", () => {
  it("is the default, even in production, and never calls fetch", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const spy = vi.fn<typeof fetch>();
    const res = await sendTemplate(msg, { fetch: spy, env: { NODE_ENV: "production" } });
    expect(res).toMatchObject({ ok: true, providerId: expect.stringMatching(/^log-/) });
    expect(res.ok && res.text).toContain("Merci pour ta visite, Awa !");
    expect(res.ok && res.text).toContain("Laisser un avis : https://kitoko.page/r/tok_123");
    expect(spy).not.toHaveBeenCalled();
    expect(info.mock.calls[0]?.[0]).toContain("[whatsapp:log] to 33612345678 (review_request, fr)");
  });

  it("prints free-form text and buttons", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const spy = vi.fn<typeof fetch>();
    expect(await sendText({ to: "+33612345678", text: "Your slot is held." }, { fetch: spy, env: {} })).toMatchObject({
      ok: true,
      text: "Your slot is held.",
    });
    expect(await sendButtons({ to: "+33612345678", text: "Refund 40 €?", buttons }, { fetch: spy, env: {} })).toMatchObject({
      ok: true,
      text: "Refund 40 €?\n\n[Confirm] [Cancel]",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown transport", async () => {
    const res = await sendText({ to: "+33612345678", text: "Hi" }, { fetch: vi.fn<typeof fetch>(), env: { WHATSAPP_TRANSPORT: "smtp" } });
    expect(res).toEqual({ ok: false, error: 'Unknown WHATSAPP_TRANSPORT "smtp"', retryable: false });
  });
});

describe("cloud transport", () => {
  it("posts the template payload to the Graph API", async () => {
    const fetch = reply(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.ABC" }] });
    expect(await sendTemplate(msg, { fetch, env: cloudEnv })).toEqual({ ok: true, providerId: "wamid.ABC" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v24.0/1234567890/messages");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    });
    expect(sentBody(fetch)).toEqual(toCloudApiPayload("review_request", "fr", "+33612345678", vars));
  });

  it("honours WHATSAPP_API_VERSION", async () => {
    const fetch = reply(200, { messages: [{ id: "wamid.X" }] });
    await sendTemplate(msg, { fetch, env: { ...cloudEnv, WHATSAPP_API_VERSION: "v99.0" } });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v99.0/1234567890/messages");
  });

  it("sends free-form text with a link preview", async () => {
    const fetch = reply(200, { messages: [{ id: "wamid.T" }] });
    const text = "Pay the deposit here: https://example.test/pay/1";
    expect(await sendText({ to: "+33 6 12 34 56 78", text }, { fetch, env: cloudEnv })).toEqual({ ok: true, providerId: "wamid.T" });
    expect(sentBody(fetch)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "33612345678",
      type: "text",
      text: { preview_url: true, body: text },
    });
    expect(sentBody(fetch)).toEqual(toTextPayload("+33612345678", text));
  });

  it("sends reply buttons as an interactive message", async () => {
    const fetch = reply(200, { messages: [{ id: "wamid.B" }] });
    expect(await sendButtons({ to: "+33612345678", text: "Refund 40 €?", buttons }, { fetch, env: cloudEnv })).toEqual({
      ok: true,
      providerId: "wamid.B",
    });
    expect(sentBody(fetch)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "33612345678",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Refund 40 €?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "confirm:pa_1", title: "Confirm" } },
            { type: "reply", reply: { id: "cancel:pa_1", title: "Cancel" } },
          ],
        },
      },
    });
    expect(sentBody(fetch)).toEqual(toButtonsPayload("+33612345678", "Refund 40 €?", buttons));
  });

  it.each([
    ["no buttons", []],
    ["four buttons", [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` }))],
    ["a title over 20 characters", [{ id: "b1", title: "Confirmer le remboursement" }]],
    ["duplicate ids", [{ id: "b", title: "Yes" }, { id: "b", title: "No" }]],
    ["duplicate titles", [{ id: "a", title: "Yes" }, { id: "b", title: "Yes" }]],
  ])("refuses buttons with %s, without calling fetch", async (_case, bad) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const res = await sendButtons({ to: "+33612345678", text: "Ok?", buttons: bad }, { fetch, env: cloudEnv });
    expect(res).toMatchObject({ ok: false, retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses empty and over-long text", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await sendText({ to: "+33612345678", text: "  " }, { fetch, env: cloudEnv })).toMatchObject({ ok: false, retryable: false });
    expect(await sendText({ to: "+33612345678", text: "x".repeat(4097) }, { fetch, env: cloudEnv })).toMatchObject({ ok: false });
    expect(await sendButtons({ to: "+33612345678", text: "x".repeat(1025), buttons }, { fetch, env: cloudEnv })).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks 429 and 5xx as retryable", async () => {
    const tooMany = reply(429, { error: { message: "Rate limit hit", code: 130429 } });
    expect(await sendTemplate(msg, { fetch: tooMany, env: cloudEnv })).toEqual({ ok: false, error: "130429: Rate limit hit", retryable: true });
    expect(await sendTemplate(msg, { fetch: reply(503, {}), env: cloudEnv })).toEqual({ ok: false, error: "HTTP 503", retryable: true });
  });

  it("marks 4xx as final", async () => {
    const bad = reply(400, { error: { message: "Invalid parameter", code: 100 } });
    expect(await sendText({ to: "+33612345678", text: "Hi" }, { fetch: bad, env: cloudEnv })).toEqual({
      ok: false,
      error: "100: Invalid parameter",
      retryable: false,
    });
  });

  it("retries Meta throttling reported as 400", async () => {
    const pair = reply(400, { error: { message: "Pair rate limit hit", code: 131056 } });
    expect(await sendTemplate(msg, { fetch: pair, env: cloudEnv })).toMatchObject({ ok: false, retryable: true });
  });

  it("retries network failures", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sendTemplate(msg, { fetch: down, env: cloudEnv })).toEqual({ ok: false, error: "fetch failed", retryable: true });
  });

  it("fails without credentials and without calling fetch", async () => {
    const spy = vi.fn<typeof fetch>();
    const res = await sendTemplate(msg, { fetch: spy, env: { WHATSAPP_TRANSPORT: "cloud" } });
    expect(res).toMatchObject({ ok: false, retryable: false });
    expect(spy).not.toHaveBeenCalled();
  });
});
