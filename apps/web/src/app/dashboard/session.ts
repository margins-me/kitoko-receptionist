import "server-only";
import { cache } from "react";
import { getPro } from "@kitoko/db";
import { serviceClient } from "@kitoko/db";
import type { Db } from "@kitoko/db";
import { createServerDb } from "@/lib/supabase/server";
import type { ProSummary } from "@/components/dashboard/model";

export type ProSession = { db: Db; pro: ProSummary };

/** The signed-in pro (auth.uid() = pros.id), verified with the auth server, or null. One lookup per request. */
export const getProSession = cache(async (): Promise<ProSession | null> => {
  const db = await createServerDb();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  const pro = await getPro(serviceClient(), data.user.id);
  if (!pro) return null;
  return {
    db,
    pro: { id: pro.id, name: pro.name, handle: pro.handle, city: pro.city, currency: pro.currency, timezone: pro.timezone, hasPayoutEmail: !!pro.paypalEmail },
  };
});
