import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { requireSupabasePublicEnv } from "./env";

/**
 * Per-request Supabase client acting as the signed-in user (publishable key + session
 * cookie), so every query is filtered by Postgres RLS. Never uses the secret key.
 */
export async function createSupabaseServerClient() {
  const { url, key } = requireSupabasePublicEnv();
  // Session handling compares token expiry with the current time, so this must run at
  // request time, never during prerendering.
  await connection();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
