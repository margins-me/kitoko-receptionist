import { describe, expect, it } from "vitest";
import { z } from "zod";
import { err, ok } from "@kitoko/booking/result";
import { callTool, defineTool, serializeOutput, toolError, toolSpecs } from "../src/core/tools";
import type { Tool } from "../src/core/tools";

type Ctx = { proId: string };
const tool = defineTool<Ctx>();

const hold = tool({
  name: "hold_slot",
  description: "Holds a slot for 15 minutes.",
  input: z.object({ service_id: z.string().describe("Service id"), start: z.string() }),
  run: async (input, ctx) => ok({ booking_id: `bk_${input.service_id}`, pro: ctx.proId, held_minutes: 15 }),
});
const taken = tool({
  name: "taken",
  description: "Always taken.",
  input: z.object({}),
  run: async () => toolError("slot_taken", "That time was just taken."),
});
const bare = tool({ name: "bare", description: "Bare error.", input: z.object({}), run: async () => err("outside_policy") });
const boom = tool({
  name: "boom",
  description: "Throws.",
  input: z.object({}),
  run: async () => {
    throw new Error("connection to db refused at 10.0.0.3");
  },
});
const tools = new Map<string, Tool<z.ZodType, Ctx>>([hold, taken, bare, boom].map((t) => [t.name, t]));
const ctx = { proId: "pro_1" };

describe("toolSpecs", () => {
  it("turns the zod input into the API's JSON schema, without $schema", () => {
    expect(toolSpecs([hold])).toEqual([
      {
        name: "hold_slot",
        description: "Holds a slot for 15 minutes.",
        input_schema: {
          type: "object",
          properties: { service_id: { type: "string", description: "Service id" }, start: { type: "string" } },
          required: ["service_id", "start"],
        },
      },
    ]);
  });

  it("refuses duplicate names, bad names and non-object inputs", () => {
    expect(() => toolSpecs([hold, hold])).toThrow(/Duplicate tool "hold_slot"/);
    expect(() => toolSpecs([{ ...hold, name: "hold slot" }])).toThrow(/must match/);
    expect(() => toolSpecs([tool({ name: "s", description: "", input: z.string(), run: async () => ok(1) })])).toThrow(/z\.object/);
  });
});

describe("serializeOutput", () => {
  it("is compact JSON, strings as they are", () => {
    expect(serializeOutput({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
    expect(serializeOutput("held")).toBe("held");
    expect(serializeOutput(undefined)).toBe("null");
  });
});

describe("callTool", () => {
  it("runs the tool with parsed input and the caller's context", async () => {
    const out = await callTool(tools, { id: "tu_1", name: "hold_slot", input: { service_id: "s1", start: "2026-10-30T10:00" } }, ctx);
    expect(out.block).toEqual({ type: "tool_result", tool_use_id: "tu_1", content: '{"booking_id":"bk_s1","pro":"pro_1","held_minutes":15}' });
    expect(out).toMatchObject({ isError: false, output: { booking_id: "bk_s1" } });
    expect(out.ms).toBeGreaterThanOrEqual(0);
  });

  it("passes a tool error with its code and message to the model", async () => {
    const out = await callTool(tools, { id: "tu_2", name: "taken", input: {} }, ctx);
    expect(out.block).toEqual({
      type: "tool_result",
      tool_use_id: "tu_2",
      content: '{"error":"slot_taken","message":"That time was just taken."}',
      is_error: true,
    });
    expect(out.isError).toBe(true);
    expect((await callTool(tools, { id: "tu_3", name: "bare", input: {} }, ctx)).block.content).toBe('{"error":"outside_policy"}');
  });

  it("reports invalid input and unknown tools as errors the model can fix", async () => {
    const invalid = await callTool(tools, { id: "tu_4", name: "hold_slot", input: { service_id: 3 } }, ctx);
    expect(invalid).toMatchObject({ isError: true, output: { error: "invalid_input" } });
    expect(String(invalid.block.content)).toContain("service_id");
    expect((await callTool(tools, { id: "tu_5", name: "refund_all", input: {} }, ctx)).output).toMatchObject({ error: "unknown_tool" });
  });

  it("hides a thrown exception from the model but keeps it for the logs", async () => {
    const out = await callTool(tools, { id: "tu_6", name: "boom", input: {} }, ctx);
    expect(out).toMatchObject({ isError: true, output: { error: "internal_error" }, detail: "connection to db refused at 10.0.0.3" });
    expect(String(out.block.content)).not.toContain("10.0.0.3");
  });
});
