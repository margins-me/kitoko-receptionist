import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { captureApprovedOrders, processPayouts, processRefunds } from "@kitoko/agent/services";
import { resetDemo } from "@kitoko/db";
import { getServicesCtx } from "@/lib/services";

// Vercel cron (vercel.json), daily: a tiny query keeps the free Supabase project from pausing; the sweeper captures
// approved orders whose return and webhook were both lost, and sends refunds and payouts left pending (PayPal down at
// the time, a crash mid-way); then each demo pro nobody used in the last hour gets a fresh demo week, so the
// calendar never drifts into the past.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ctx = getServicesCtx();
  const { error } = await ctx.db.from("pros").select("id").limit(1);
  if (error) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  const captures = await captureApprovedOrders(ctx);
  const [refunds, payouts] = await Promise.all([processRefunds(ctx), processPayouts(ctx)]);

  const { data: pros } = await ctx.db.from("pros").select("id");
  const reset: string[] = [];
  for (const { id } of pros ?? []) {
    const { data: recent } = await ctx.db
      .from("agent_events")
      .select("id")
      .eq("pro_id", id)
      .neq("name", "demo.reset")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
      .limit(1);
    if (recent?.length) continue;
    if ((await resetDemo(ctx.db, id)).ok) reset.push(id);
  }

  return NextResponse.json({
    ok: true,
    captures: captures.ok ? captures.value : captures.error,
    reset: reset.length,
    refunds: refunds.ok ? refunds.value.length : refunds.error,
    payouts: payouts.ok ? payouts.value.length : payouts.error,
  });
}
