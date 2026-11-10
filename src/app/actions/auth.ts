"use server";

import { redirect } from "next/navigation";
import { isDemoUserKey } from "@/lib/demo/demo-users";
import { switchDemoUser } from "@/lib/demo/switch-user";
import { safeNextPath } from "@/lib/safe-next";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * One-click sign-in (and role switch) for the synthetic demo accounts.
 * The password stays on the server; the browser only sends which demo person to use.
 * Signing in as a different user is a real Supabase session, so RLS applies as that user.
 *
 * `club=mine` switches role inside the visitor's own copy of the demo club. The copy is the
 * one the current session is a member of (read through RLS), so a visitor can only ever
 * switch between the four accounts of their own copy.
 */
export async function signInAsDemo(formData: FormData): Promise<void> {
  const key = formData.get("user");
  const next = safeNextPath(formData.get("next"));
  if (!isDemoUserKey(key)) redirect("/login?error=unknown-user");
  const problem = await switchDemoUser(key, formData.get("club") === "mine" ? "mine" : "shared");
  if (problem) redirect(`/login?error=${problem}`);
  redirect(next);
}

export async function signOut(): Promise<void> {
  if (supabasePublicEnv()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/login");
}
