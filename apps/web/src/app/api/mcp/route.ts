import { createServicesCtx } from "@kitoko/agent/services";
import { createRateLimiter, handleMcpPost, methodNotAllowed, preflight } from "@kitoko/mcp";

// "Book with Kitoko": the remote MCP server (Streamable HTTP, stateless, JSON responses). Add
// https://<host>/api/mcp as a custom connector in Claude (docs/mcp.md).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 20 holds per hour per IP. In memory: per server instance, reset on a cold start (enough for the demo).
const holds = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  return handleMcpPost(request, () => createServicesCtx(), { allowHold: () => holds.take(ip) });
}

// A browser opening the URL (a judge clicking the link) is sent to the page on how to connect; MCP clients get the
// JSON-RPC "method not allowed" as before.
export function GET(request: Request): Response {
  if (!request.headers.get("accept")?.includes("text/html")) return methodNotAllowed();
  return Response.redirect(new URL("/how-it-works/mcp", request.url), 307);
}

export const DELETE = methodNotAllowed;
export const OPTIONS = preflight;
