"use server";

import { redirect } from "next/navigation";
import { demoUser, isDemoUserKey } from "@/lib/demo/demo-users";
import { sandboxEmail, sandboxPassword } from "@/lib/demo/sandbox";
import { sandboxConfig } from "@/lib/demo/sandbox-server";
import { safeNextPath } from "@/lib/safe-next";
import { getViewer } from "@/lib/session";
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
  if (!supabasePublicEnv()) redirect("/login?error=not-configured");

  let email: string;
  let password: string;
  if (formData.get("club") === "mine") {
    const cfg = sandboxConfig();
    if (!cfg) redirect("/login?error=copy-not-configured");
    const viewer = await getViewer();
    const expires = viewer?.membership?.sandboxExpiresAt;
    if (!viewer?.membership || !expires) redirect("/login?error=copy-missing");
    if (new Date(expires).getTime() <= Date.now()) redirect("/login?error=copy-expired");
    email = sandboxEmail(viewer.membership.workspaceId, key);
    password = sandboxPassword(cfg.secret, email);
  } else {
    const shared = process.env.DEMO_USER_PASSWORD;
    if (!shared) redirect("/login?error=not-configured");
    email = demoUser(key).email;
    password = shared;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
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
