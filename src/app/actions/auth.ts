"use server";

import { redirect } from "next/navigation";
import { demoUser, isDemoUserKey } from "@/lib/demo/demo-users";
import { safeNextPath } from "@/lib/safe-next";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * One-click sign-in (and role switch) for the four synthetic demo accounts.
 * The password stays on the server; the browser only sends which demo user to use.
 * Signing in as a different user is a real Supabase session, so RLS applies as that user.
 */
export async function signInAsDemo(formData: FormData): Promise<void> {
  const key = formData.get("user");
  const next = safeNextPath(formData.get("next"));
  if (!isDemoUserKey(key)) redirect("/login?error=unknown-user");

  const password = process.env.DEMO_USER_PASSWORD;
  if (!password || !supabasePublicEnv()) redirect("/login?error=not-configured");

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email: demoUser(key).email, password });
  if (error) redirect("/login?error=sign-in-failed");

  redirect(next);
}

export async function signOut(): Promise<void> {
  if (supabasePublicEnv()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/login");
}
