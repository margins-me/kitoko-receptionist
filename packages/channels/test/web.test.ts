import { afterEach, describe, expect, it, vi } from "vitest";
import { deliver, whatsappText } from "../src/web";

const cloudEnv = { WHATSAPP_TRANSPORT: "cloud", WHATSAPP_PHONE_NUMBER_ID: "1234567890", WHATSAPP_ACCESS_TOKEN: "test-token" };
const ok = () => vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.D" }] }));

afterEach(() => vi.restoreAllMocks());

describe("deliver", () => {
  it.each(["web", "mcp"] as const)("has nothing to send on %s", async (channel) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await deliver({ channel, to: "conv_1", text: "Hello" }, { fetch, env: cloudEnv })).toEqual({ ok: true, providerId: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends WhatsApp text", async () => {
    const fetch = ok();
    expect(await deliver({ channel: "whatsapp", to: "+33612345678", text: "**Booked!**" }, { fetch, env: cloudEnv })).toEqual({
      ok: true,
      providerId: "wamid.D",
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ type: "text", text: { body: "*Booked!*" } });
  });

  it("sends WhatsApp reply buttons when given", async () => {
    const fetch = ok();
    const buttons = [{ id: "confirm:pa_1", title: "Confirm" }];
    await deliver({ channel: "whatsapp", to: "+33612345678", text: "Refund 40 €?", buttons }, { fetch, env: cloudEnv });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ type: "interactive", interactive: { type: "button" } });
  });
});

describe("whatsappText", () => {
  it("rewrites Markdown bold and links", () => {
    expect(whatsappText("**Saturday 10:00** - [Pay the deposit](https://example.test/pay/1)")).toBe(
      "*Saturday 10:00* - Pay the deposit: https://example.test/pay/1",
    );
    expect(whatsappText("[https://example.test](https://example.test)")).toBe("https://example.test");
  });
});
