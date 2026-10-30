import { addDays, localDate, resolveLocal } from "@kitoko/booking";
import { createClient } from "@supabase/supabase-js";
import { anonClient, serviceClient } from "../src/clients";
import type { Db } from "../src/clients";
import type { Database } from "../src/types.gen";

// supabase/seed.sql (all fictional)
export const NALA = "a0000000-0000-4000-8000-000000000001"; // Studio Nala, Lyon, EUR, two staff
export const KEMI = "a0000000-0000-4000-8000-000000000002"; // Kemi Nails, London, GBP
export const AICHA = "a0000000-0000-4000-8000-000000000003"; // Aïcha Braids, Milan, EUR
export const STAFF = {
  nala: "5a000000-0000-4000-8000-000000000011",
  sira: "5a000000-0000-4000-8000-000000000012",
  kemi: "5a000000-0000-4000-8000-000000000021",
  aicha: "5a000000-0000-4000-8000-000000000031",
} as const;
export const SERVICES = {
  nalaNattes: "b0000000-0000-4000-8000-000000000014",
  nalaSemi: "b0000000-0000-4000-8000-000000000016",
  kemiGel: "b0000000-0000-4000-8000-000000000021",
  aichaCornrows: "b0000000-0000-4000-8000-000000000034",
} as const;
export const DEMO_PASSWORD = "kitoko-demo-2026";

export const svc = (): Db => serviceClient();
export const anon = (): Db => anonClient();

/** A client signed in as a demo pro (password sign-in, like the dashboard). */
export async function proClient(email: string): Promise<Db> {
  const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw error;
  return db;
}

/** An instant `days` from today at a local time, in a time zone. */
export const at = (tz: string, days: number, time: string) => resolveLocal(addDays(localDate(Date.now(), tz), days), time, tz).at;

export const HOUR = 3_600_000;

/** Deletes a pro's bookings starting in [from, to) and their payments, refunds and payouts (cascade), and her blocks there. */
export async function cleanup(proId: string, from: number, to: number): Promise<void> {
  const range = `[${new Date(from).toISOString()},${new Date(to).toISOString()})`;
  const db = svc();
  await db.from("bookings").delete().eq("pro_id", proId).overlaps("during", range).throwOnError();
  await db.from("blocks").delete().eq("pro_id", proId).overlaps("during", range).throwOnError();
}
