import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Db } from "./load-club";
import { SANDBOX_COOKIE, purgeOne } from "./sandbox";

/**
 * Server-side pieces of "Load demo club". The secret (service-role) key is read here and
 * nowhere near the browser: it creates and deletes the copies' accounts, and derives their
 * passwords and the return cookie.
 */
export function sandboxConfig(): { url: string; publishableKey: string; secret: string } | null {
  const pub = supabasePublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  return pub && secret ? { url: pub.url, publishableKey: pub.key, secret } : null;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(cfg: { url: string; secret: string }): Db {
  return createClient<Database>(cfg.url, cfg.secret, opts);
}

/** A throwaway client signed in as one account; nothing is stored in cookies. */
export async function ephemeralSignIn(cfg: { url: string; publishableKey: string }, email: string, password: string): Promise<Db> {
  const client = createClient<Database>(cfg.url, cfg.publishableKey, opts);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in: ${error.message}`);
  return client;
}

export function sandboxCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/**
 * After a visitor deletes their own copy (through delete_workspace, as themselves), remove
 * its accounts too, forget the cookie and sign out. Not a server action: it is called only by
 * the delete-workspace action, after the database has accepted the deletion.
 */
export async function forgetDeletedCopy(workspaceId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(SANDBOX_COOKIE);
  const cfg = sandboxConfig();
  if (!cfg) return;
  const admin = serviceClient(cfg);
  const { data } = await admin.from("demo_sandboxes").select("id, user_ids, workspace_id").eq("id", workspaceId).maybeSingle();
  // Only once the workspace is really gone. If this fails, the daily clean-up removes the
  // accounts later (the row has no workspace now).
  if (data && data.workspace_id === null) await purgeOne(admin, data).catch(() => {});
}
