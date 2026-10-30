import { describe, expect, it } from "vitest";
import { toolSpecs } from "../src/core/tools";
import { buildParams, hasServerFallback } from "../src/model/anthropic";
import { nearestPerDay, spread } from "../src/services/booking";
import { replyButtons } from "../src/services/conversation";
import { modelFactory } from "../src/services/ctx";
import { asE164, payoutStatusOf } from "../src/services/payments";
import { localLabel, moneyText, toEpoch } from "../src/services/util";
import { CLIENT_TOOLS } from "../src/prompts/client";
import { clientTools } from "../src/tools/client";
import { buildProTools, PRO_TOOL_NAMES } from "../src/tools/pro";
import { PAYPAL_TOOLKIT_READS } from "../src/tools/paypal-toolkit";

const req = { system: { base: "b", context: "c" }, tools: [], messages: [{ role: "user" as const, content: "Hi" }] };

describe("server-side refusal fallback", () => {
  it("is only sent for claude-sonnet-5-5 and Opus", () => {
    expect(hasServerFallback("claude-sonnet-5-5")).toBe(true);
    expect(hasServerFallback("claude-opus-4-8")).toBe(true);
    expect(hasServerFallback("claude-haiku-5-5")).toBe(false);
    const haiku = buildParams(req, { model: "claude-haiku-5-5", effort: "medium", maxTokens: 1000 });
    expect("fallbacks" in haiku || "betas" in haiku).toBe(false);
    expect(buildParams(req, { model: "claude-sonnet-5-5", effort: "medium", maxTokens: 1000 })).toMatchObject({ fallbacks: "default" });
  });

  it("picks Haiku for clients and Sonnet for the pro, the rule-based fake with AGENT_FAKE=1", () => {
    expect(modelFactory({})("client").id).toBe("claude-haiku-5-5");
    expect(modelFactory({})("pro").id).toBe("claude-sonnet-5-5");
    expect(modelFactory({ AGENT_MODEL_CLIENT: "claude-sonnet-5-5" })("client").id).toBe("claude-sonnet-5-5");
    expect(modelFactory({ AGENT_FAKE: "1" })("client").id).toBe("fake-rule-based");
  });
});

describe("helpers", () => {
  it("reads local times in the salon's zone and ISO with offsets as given", () => {
    expect(toEpoch("2026-10-31T09:00", "Europe/Rome")).toBe(Date.parse("2026-10-31T08:00:00Z"));
    expect(toEpoch("2026-10-31T09:00:00+01:00", "Europe/Rome")).toBe(Date.parse("2026-10-31T08:00:00Z"));
    expect(toEpoch("nope")).toBeNaN();
  });

  it("spreads slots over the days, earliest first", () => {
    const day = 86_400_000;
    const base = Date.parse("2026-11-02T08:00:00Z");
    const slots = [0, 1, 2].flatMap((d) => [0, 1, 2, 3].map((h) => ({ start: base + d * day + h * 3_600_000 })));
    const picked = spread(slots, 6, "UTC");
    expect(picked.map((s) => new Date(s.start).toISOString().slice(8, 13))).toEqual(["02T08", "02T09", "03T08", "03T09", "04T08", "04T09"]);
  });

  it("keeps, per day, the free starts nearest an asked time", () => {
    const at = (iso: string, time: string) => ({ time, start: Date.parse(iso), end: Date.parse(iso) + 3_600_000, staffIds: ["s"] });
    const slots = [
      at("2026-11-02T09:00:00Z", "09:00"), at("2026-11-02T13:00:00Z", "13:00"), at("2026-11-02T15:30:00Z", "15:30"),
      at("2026-11-03T09:00:00Z", "09:00"), at("2026-11-03T14:00:00Z", "14:00"),
      at("2026-11-04T13:00:00Z", "13:00"), at("2026-11-04T15:00:00Z", "15:00"),
    ];
    expect(nearestPerDay(slots, "14:00", "UTC").map((s) => `${new Date(s.start).getUTCDate()} ${s.time}`)).toEqual(["2 13:00", "3 14:00", "4 13:00", "4 15:00"]);
  });

  it("maps PayPal payout item statuses", () => {
    expect(payoutStatusOf("SUCCESS")).toBe("succeeded");
    expect(payoutStatusOf("SUCCEEDED")).toBe("succeeded");
    expect(payoutStatusOf("UNCLAIMED")).toBe("unclaimed");
    expect(payoutStatusOf("RETURNED")).toBe("failed");
    expect(payoutStatusOf("PENDING")).toBeNull();
  });
});

describe("money and time across currencies and time zones", () => {
  it("formats GBP for Kemi as she and her clients read it", () => {
    expect(moneyText(3150, "en", "GBP")).toBe("£31.50");
    expect(moneyText(3000, "en", "GBP")).toBe("£30");
    expect(moneyText(3150, "fr", "EUR")).toBe("31,50 €");
  });

  it("reads one instant in London and in Rome, across the October DST change", () => {
    // Sunday 25 October 2026: both zones leave summer time at 01:00 UTC.
    const before = Date.parse("2026-10-24T08:00:00Z");
    const after = Date.parse("2026-10-26T08:00:00Z");
    expect(localLabel(before, "Europe/London", "en")).toBe("Saturday 24 October at 09:00");
    expect(localLabel(before, "Europe/Rome", "en")).toBe("Saturday 24 October at 10:00");
    expect(localLabel(after, "Europe/London", "en")).toBe("Monday 26 October at 08:00");
    expect(localLabel(after, "Europe/Rome", "en")).toBe("Monday 26 October at 09:00");
    // A 09:00 slot is read in the salon's zone, whatever the server's.
    expect(toEpoch("2026-10-24T09:00", "Europe/London")).toBe(Date.parse("2026-10-24T08:00:00Z"));
    expect(toEpoch("2026-10-26T09:00", "Europe/London")).toBe(Date.parse("2026-10-26T09:00:00Z"));
    expect(toEpoch("2026-10-26T09:00", "Europe/Rome")).toBe(Date.parse("2026-10-26T08:00:00Z"));
  });
});

describe("tool lists", () => {
  it("registers exactly the client tools the prompt names, with valid schemas and no amount inputs", () => {
    expect(clientTools.map((t) => t.name).toSorted()).toEqual(Object.values(CLIENT_TOOLS).toSorted());
    const specs = toolSpecs(clientTools);
    const keys = (schema: unknown): string[] =>
      schema && typeof schema === "object"
        ? Object.entries(schema as Record<string, unknown>).flatMap(([k, v]) => (k === "properties" && v && typeof v === "object" ? [...Object.keys(v), ...Object.values(v).flatMap(keys)] : keys(v)))
        : [];
    for (const s of specs) expect(keys(s.input_schema).filter((k) => /cents|amount|price|refund/i.test(k)), s.name).toEqual([]);
  });

  it("adds the PayPal Agent Toolkit read tools only with sandbox credentials", () => {
    expect(buildProTools({ PAYPAL_ENV: "fake", PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" }).map((t) => t.name)).toEqual(PRO_TOOL_NAMES);
    expect(buildProTools({}).map((t) => t.name)).toEqual(PRO_TOOL_NAMES);
    const tools = buildProTools({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" });
    const paypal = tools.filter((t) => t.name.startsWith("paypal_")).map((t) => t.name.slice(7));
    expect(paypal.toSorted()).toEqual([...PAYPAL_TOOLKIT_READS].toSorted());
    expect(() => toolSpecs(tools)).not.toThrow();
  });
});

describe("asE164", () => {
  it("normalises international numbers and refuses local ones", () => {
    expect(asE164("+39 333 123 4567")).toBe("+393331234567");
    expect(asE164("0044 (20) 7946-0958")).toBe("+442079460958");
    expect(asE164("333 123 4567")).toBeNull();
    expect(asE164("")).toBeNull();
    expect(asE164(undefined)).toBeNull();
  });
});

describe("WhatsApp reply buttons from offer_choices", () => {
  const offer = (choices: string[]) => [
    { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "t1", name: "offer_choices", input: { choices } }] },
  ];
  it("become buttons when Meta takes them, else the text goes alone", () => {
    expect(replyButtons(offer(["Sat 9:00", "Tue 13:00"]), "Which one?")).toEqual([
      { id: "choice:0", title: "Sat 9:00" },
      { id: "choice:1", title: "Tue 13:00" },
    ]);
    expect(replyButtons(offer(["a", "b", "c", "d"]), "Which one?")).toBeUndefined();
    expect(replyButtons(offer(["Sabato 31 ottobre, ore 9:00"]), "Quale?")).toBeUndefined();
    expect(replyButtons(offer(["Sat 9:00"]), "x".repeat(1100))).toBeUndefined();
    expect(replyButtons([], "Hi")).toBeUndefined();
  });
});
