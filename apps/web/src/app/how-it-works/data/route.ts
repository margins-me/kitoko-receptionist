import { loadTimeline } from "../load-timeline";

// Polled every 3 s by the "How it works" timeline: same selector as the page (?ref=, ?b=, or the latest demo booking).

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const result = await loadTimeline({ ref: params.get("ref") ?? undefined, b: params.get("b") ?? undefined });
  return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
