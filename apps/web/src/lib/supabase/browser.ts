"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// The pro's session in the browser (cookies written by the login server action), for Realtime only: every read and
// write goes through server actions. One client per tab.

let client: SupabaseClient | null = null;

export function browserDb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).");
    client = createBrowserClient(url, key);
  }
  return client;
}
