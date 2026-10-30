import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.gen";

export type Db = SupabaseClient<Database>;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Public reads (live pros' pages, busy intervals). RLS applies. */
export function anonClient(): Db {
  return createClient<Database>(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), options);
}

/** Everything else: the SQL functions and the agent tables are service-role only. Server code only. */
export function serviceClient(): Db {
  return createClient<Database>(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), options);
}
