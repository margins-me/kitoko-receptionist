import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database, Db } from "@kitoko/db";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * A Supabase client acting as the signed-in pro (RLS applies), bound to this request's cookies.
 * Create one per request. In a Server Component it cannot write cookies (a refreshed token is then written by the
 * next server action or route handler).
 */
export async function createServerDb(): Promise<Db> {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies.
        }
      },
    },
  });
}

/** The signed-in user's id (= the pro id), or null. Verified with the auth server, not just read from the cookie. */
export async function getSessionUserId(db?: Db): Promise<string | null> {
  const client = db ?? (await createServerDb());
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
