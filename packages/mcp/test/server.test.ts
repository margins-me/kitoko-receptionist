import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createKitokoMcpServer, SERVER_INSTRUCTIONS } from "../src/server";
import { handleMcpPost, methodNotAllowed } from "../src/http";

// No database here: the context factory is never reached by listing tools or by input validation.
const noCtx = () => {
  throw new Error("no context in unit tests");
};

async function connect() {
  const server = createKitokoMcpServer(noCtx);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe("Book with Kitoko MCP server", () => {
  it("lists the four tools with their schemas and annotations", async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).toSorted()).toEqual(["book_with_deposit", "booking_status", "get_availability", "search_pros"]);

    expect(byName.search_pros!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get_availability!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.booking_status!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.book_with_deposit!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });

    expect(Object.keys(byName.search_pros!.inputSchema.properties ?? {}).toSorted()).toEqual([
      "city",
      "currency",
      "date",
      "max_price",
      "service",
      "time_of_day",
    ]);
    expect(byName.search_pros!.inputSchema.required ?? []).toEqual([]);
    expect(byName.get_availability!.inputSchema.required?.toSorted()).toEqual(["date_from", "date_to", "pro_handle", "service_id"]);
    expect(byName.book_with_deposit!.inputSchema.required?.toSorted()).toEqual(["first_name", "pro_handle", "service_id", "start"]);
    expect(byName.booking_status!.inputSchema.required).toEqual(["ref"]);
    // Tools take ids and times, never amounts.
    for (const t of tools) {
      expect(Object.keys(t.inputSchema.properties ?? {}).filter((k) => /amount|cents|deposit|fee|total/.test(k))).toEqual([]);
    }
    expect(byName.book_with_deposit!.description).toContain("you cannot pay on their behalf");
    // Shop for me: compare a few options, let the human choose, never invent reviews.
    for (const text of [byName.search_pros!.description, SERVER_INSTRUCTIONS]) {
      expect(text).toContain("present up to 2–3 options side by side (price, time, deposit, cancellation, area)");
      expect(text).toContain("let the human choose before calling book_with_deposit");
      expect(text).toContain("Never claim reviews or ratings: Kitoko does not have them.");
    }
    expect(byName.book_with_deposit!.inputSchema.properties?.start).toMatchObject({ description: expect.stringContaining("search_pros") });
  });

  it("rejects invalid input before touching the services", async () => {
    const client = await connect();
    const bad = await client.callTool({ name: "booking_status", arguments: { ref: "not a ref" } });
    expect(bad.isError).toBe(true);
    const badStart = await client.callTool({
      name: "book_with_deposit",
      arguments: { pro_handle: "aicha.braids", service_id: "x", start: "tomorrow", first_name: "Ada" },
    });
    expect(badStart.isError).toBe(true);
  });

  it("answers initialize over stateless HTTP with JSON and CORS headers", async () => {
    const response = await handleMcpPost(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "1" } },
        }),
      }),
      noCtx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = (await response.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe("kitoko");
    expect(body.result.instructions).toContain("book_with_deposit");
    expect(methodNotAllowed().status).toBe(405);
  });
});
