"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { listConversations, listMessages, resetDemo, serviceClient } from "@kitoko/db";
import {
  blockTime,
  bookableStarts,
  cancelBooking,
  decideAction,
  earnings,
  markDone,
  moveTargets,
  proposeMove,
} from "@kitoko/agent/services";
import { actionServicesCtx } from "@/lib/services";
import { createServerDb } from "@/lib/supabase/server";
import { loadMoneyRows, loadWeek } from "@/components/dashboard/load";
import { addDays } from "@/components/dashboard/time";
import type { ActionResult, BookableTick, ChatLine, DropTargets, MoneyData, WeekData } from "@/components/dashboard/model";
import { getProSession } from "./session";

// Every action checks the session first and only touches the signed-in pro's rows. Money and bookings move through
// @kitoko/agent/services (never PayPal or SQL from here).

const epoch = z.number().int().min(0).max(4_102_444_800_000);
const uuid = z.uuid();

async function requirePro() {
  const session = await getProSession();
  if (!session) redirect("/dashboard/login");
  return session;
}

/** True when the booking is hers (RLS on her own client returns nothing otherwise). */
async function ownsBooking(bookingId: string): Promise<boolean> {
  const { db } = await requirePro();
  const { data } = await db.from("bookings").select("id").eq("id", bookingId).maybeSingle();
  return data !== null;
}

function failure(error: unknown): ActionResult {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Something went wrong";
  return { ok: false, error: message.replaceAll("_", " ") };
}

// --- auth --------------------------------------------------------------------------------------------------------

export type LoginState = { error: string | null; email: string };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.object({ email: z.email(), password: z.string().min(1).max(200) }).safeParse({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (!parsed.success) return { error: "Enter an e-mail address and a password.", email: String(form.get("email") ?? "") };
  const db = await createServerDb();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong e-mail or password.", email: parsed.data.email };
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const db = await createServerDb();
  await db.auth.signOut();
  redirect("/dashboard/login");
}

// --- reads -------------------------------------------------------------------------------------------------------

export async function fetchWeek(weekStart: number): Promise<WeekData> {
  const { db, pro } = await requirePro();
  const start = epoch.parse(weekStart);
  return loadWeek(db, pro.id, start, addDays(start, 7, pro.timezone));
}

export async function fetchMoney(from: number, to: number): Promise<MoneyData> {
  const { db, pro } = await requirePro();
  const range = { from: epoch.parse(from), to: epoch.parse(to) };
  const [local, result] = await Promise.all([
    loadMoneyRows(db, pro.id, range.from, range.to),
    earnings(await actionServicesCtx(), { proId: pro.id, from: range.from, to: range.to }).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "earnings unavailable",
    })),
  ]);
  if (!result.ok) return { ...local, paypal: null, earningsError: String(result.error) };
  const e = result.value;
  return {
    ...local,
    totals: {
      capturedCents: e.capturedCents,
      refundedCents: e.refundedCents,
      paidOutCents: e.paidOutCents,
      pendingPayoutCents: e.pendingPayoutCents,
      feesCents: e.feesCents,
    },
    paypal: e.paypal ? { rows: e.paypal.rows.length, lastRefreshed: e.paypal.lastRefreshed } : null,
    earningsError: null,
  };
}

/** At most two weeks of calendar per call (the visible week, plus slack). */
const MAX_SPAN = 15 * 24 * 60 * 60 * 1000;

/**
 * The starts a dragged booking can be proposed at over [from, to) (the visible week): same service, length and staff
 * rules, free, inside her hours and fixed start times, its own time not counting. The calendar highlights them.
 */
export async function dropTargets(bookingId: string, from: number, to: number): Promise<DropTargets> {
  const id = uuid.parse(bookingId);
  const range = { from: epoch.parse(from), to: epoch.parse(to) };
  if (range.to <= range.from || range.to - range.from > MAX_SPAN) return { ok: false, error: "Check the dates" };
  if (!(await ownsBooking(id))) return { ok: false, error: "Booking not found" };
  const result = await moveTargets(await actionServicesCtx(), { bookingId: id, ...range });
  if (!result.ok) return { ok: false, error: result.error.replaceAll("_", " ") };
  return { ok: true, starts: result.value.map((s) => ({ start: Date.parse(s.start), staffIds: s.staffIds })) };
}

/** Where a new booking of her shortest service could start over [from, to), per staff: the calendar's at-rest ticks. */
export async function fetchBookableTicks(from: number, to: number): Promise<BookableTick[]> {
  const { pro } = await requirePro();
  const range = { from: epoch.parse(from), to: epoch.parse(to) };
  if (range.to <= range.from || range.to - range.from > MAX_SPAN) return [];
  const result = await bookableStarts(await actionServicesCtx(), { proId: pro.id, ...range });
  return result.ok ? result.value.map((s) => ({ start: s.start, staffId: s.staffId })) : [];
}

/** Her assistant conversation so far (visible messages, text only). */
export async function fetchProChat(): Promise<ChatLine[]> {
  const { db, pro } = await requirePro();
  const [conversation] = await listConversations(db, pro.id, { kind: "pro", limit: 1 });
  if (!conversation) return [];
  const messages = await listMessages(db, conversation.id, { visibleOnly: true });
  return messages.slice(-40).flatMap((m): ChatLine[] => {
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .map((block) => (block && typeof block === "object" && !Array.isArray(block) && block.type === "text" ? String(block.text ?? "") : ""))
            .join("")
        : "";
    return text.trim() ? [{ id: String(m.id), role: m.role, text, at: m.createdAt }] : [];
  });
}

// --- booking actions -----------------------------------------------------------------------------------------------

export async function markDoneAction(bookingId: string, outcome: "honoured" | "no_show"): Promise<ActionResult> {
  const id = uuid.parse(bookingId);
  if (!(await ownsBooking(id))) return { ok: false, error: "Booking not found" };
  try {
    const result = await markDone(await actionServicesCtx(), { bookingId: id, outcome: z.enum(["honoured", "no_show"]).parse(outcome) });
    if (!result.ok) return failure(result.error);
    const label = outcome === "honoured" ? "Marked done" : "Marked no-show";
    const payout =
      result.value.payoutCents === null
        ? null
        : result.value.payoutIssue === "no_paypal_email"
          ? "payout queued: add your PayPal e-mail to receive it"
          : result.value.payoutIssue === "paypal_unavailable"
            ? "payout queued: PayPal did not answer, it is retried daily"
            : result.value.payoutStatus === "unclaimed"
              ? "payout unclaimed: no PayPal account on your e-mail"
              : result.value.payoutStatus === "failed"
                ? "payout failed"
                : "payout on its way";
    return { ok: true, message: payout ? `${label} · ${payout}` : label };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelBookingAction(bookingId: string): Promise<ActionResult> {
  const id = uuid.parse(bookingId);
  if (!(await ownsBooking(id))) return { ok: false, error: "Booking not found" };
  try {
    const result = await cancelBooking(await actionServicesCtx(), { bookingId: id, by: "pro", reason: "Cancelled by the pro from the calendar" });
    if (!result.ok) return failure(result.error);
    const r = result.value;
    const message =
      r.released || r.refundStatus === "none"
        ? "Cancelled"
        : r.refundStatus === "succeeded"
          ? "Cancelled · full refund sent through PayPal"
          : r.refundStatus === "pending"
            ? "Cancelled · refund queued: PayPal did not answer, it is retried daily"
            : "Cancelled · the PayPal refund failed: see the booking";
    return { ok: true, message };
  } catch (error) {
    return failure(error);
  }
}

export async function proposeMoveAction(bookingId: string, start: number): Promise<ActionResult> {
  const id = uuid.parse(bookingId);
  if (!(await ownsBooking(id))) return { ok: false, error: "Booking not found" };
  try {
    const result = await proposeMove(await actionServicesCtx(), { bookingId: id, start: epoch.parse(start) });
    if (!result.ok) return failure(result.error);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function blockTimeAction(input: { staffId: string | null; from: number; to: number; label: string }): Promise<ActionResult & { displaced?: number }> {
  const { db, pro } = await requirePro();
  const parsed = z
    .object({ staffId: uuid.nullable(), from: epoch, to: epoch, label: z.string().trim().min(1).max(60) })
    .refine((v) => v.to > v.from && v.to - v.from <= 14 * 24 * 60 * 60 * 1000, "The end must be after the start (14 days at most).")
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the dates" };
  if (parsed.data.staffId) {
    const { data } = await db.from("staff").select("id").eq("id", parsed.data.staffId).maybeSingle();
    if (!data) return { ok: false, error: "Unknown staff member" };
  }
  try {
    const result = await blockTime(await actionServicesCtx(), { proId: pro.id, ...parsed.data });
    if (!result.ok) return failure(result.error);
    const displaced: unknown = (result.value as { displaced?: unknown }).displaced;
    const count = Array.isArray(displaced) ? displaced.length : typeof displaced === "number" ? displaced : 0;
    return {
      ok: true,
      displaced: count,
      message: count === 0 ? "Time blocked" : `Time blocked · asking ${count} client${count === 1 ? "" : "s"} to move`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function decideActionAction(actionId: string, decision: "confirmed" | "cancelled"): Promise<ActionResult> {
  const { pro } = await requirePro();
  try {
    const result = await decideAction(await actionServicesCtx(), {
      actionId: uuid.parse(actionId),
      decision: z.enum(["confirmed", "cancelled"]).parse(decision),
      proId: pro.id,
    });
    if (!result.ok) return failure(result.error);
    if (decision === "cancelled") return { ok: true, message: "Cancelled" };
    const invoice = result.value.action.kind === "invoice" ? (result.value.result as { invoiceId?: unknown; payerViewUrl?: unknown; status?: unknown } | null) : null;
    if (invoice && typeof invoice.invoiceId === "string") {
      const href = typeof invoice.payerViewUrl === "string" && /^https:\/\/[^/]*paypal\.com\//.test(invoice.payerViewUrl) ? invoice.payerViewUrl : null;
      return {
        ok: true,
        message: `Invoice ${invoice.invoiceId} sent through PayPal`,
        detail: `PayPal invoice ${invoice.invoiceId} · ${typeof invoice.status === "string" ? invoice.status.toLowerCase() : "sent"}`,
        ...(href ? { link: { href, label: "Open the invoice the client sees" } } : {}),
      };
    }
    return { ok: true, message: "Done · sent through PayPal" };
  } catch (error) {
    return failure(error);
  }
}

/** Judges share each demo login: one reset per 5 minutes, so one of them cannot wipe another's run again and again. */
const RESET_EVERY_MS = 5 * 60_000;

export async function resetDemoAction(): Promise<ActionResult> {
  const { pro } = await requirePro();
  const db = serviceClient();
  // reset_demo clears agent_events, so a demo.reset row newer than 5 minutes means the last reset was that recent.
  const { data: last } = await db
    .from("agent_events")
    .select("created_at")
    .eq("pro_id", pro.id)
    .eq("name", "demo.reset")
    .gte("created_at", new Date(Date.now() - RESET_EVERY_MS).toISOString())
    .limit(1);
  if (last?.length) return { ok: false, error: "The demo was reset less than 5 minutes ago. Try again in a few minutes." };
  const result = await resetDemo(db, pro.id);
  if (!result.ok) return failure(result.error);
  await db.from("agent_events").insert({ kind: "system", name: "demo.reset", pro_id: pro.id });
  return { ok: true, message: "Demo week restored" };
}
