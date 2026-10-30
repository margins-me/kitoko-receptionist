import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createKitokoMcpServer } from "./server";
import type { CtxFactory, KitokoMcpOptions } from "./server";

/** Browser-based MCP clients (MCP Inspector, web playgrounds) call cross-origin. No cookies are used. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * One MCP Streamable HTTP POST, stateless: a fresh server and transport per request (no session id, JSON responses,
 * no SSE stream), closed once the response is ready. Fits a serverless route handler.
 */
export async function handleMcpPost(request: Request, ctxFactory: CtxFactory, options: KitokoMcpOptions = {}): Promise<Response> {
  const server = createKitokoMcpServer(ctxFactory, options);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/** GET (server-sent events) and DELETE (sessions) do not exist on a stateless server. */
export function methodNotAllowed(): Response {
  return withCors(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed: this MCP server is stateless. Send JSON-RPC with POST." },
        id: null,
      }),
      { status: 405, headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS" } },
    ),
  );
}

export const preflight = (): Response => withCors(new Response(null, { status: 204 }));
