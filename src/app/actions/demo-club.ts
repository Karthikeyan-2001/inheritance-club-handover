"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SANDBOX_COOKIE,
  SandboxLimitError,
  createSandbox,
  isClubKind,
  purgeOne,
  readSandboxCookie,
  sandboxEmail,
  sandboxPassword,
  signSandboxCookie,
} from "@/lib/demo/sandbox";
import { ephemeralSignIn, sandboxConfig, sandboxCookieOptions, serviceClient } from "@/lib/demo/sandbox-server";
import type { Db } from "@/lib/demo/load-club";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setTourCookie } from "@/lib/tour/tour-cookie";

/**
 * "Load demo club": build the visitor their own copy of the synthetic club and sign them in
 * as its outgoing lead. The form's `club` chooses what the copy starts with: the built year
 * club ("year", the default) or nothing at all ("empty", to import the sample files). The visitor's session is the cookie client, which also makes the
 * outgoing lead's release and ready mark; the advisor's approval of version 1 uses a
 * throwaway session. Two sign-ins per copy, because auth sign-ins are rate limited.
 */
export async function loadDemoClub(form: FormData): Promise<void> {
  const requested = form.get("club");
  const club = isClubKind(requested) && requested !== "toy" ? requested : "year";
  const cfg = sandboxConfig();
  if (!cfg) redirect("/login?error=copy-not-configured");

  const jar = await cookies();
  const previous = readSandboxCookie(cfg.secret, jar.get(SANDBOX_COOKIE)?.value, new Date());
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const admin = serviceClient(cfg);

  let outcome: "ok" | "full" | "busy" | "failed" = "failed";
  let cookie: { value: string; expiresAt: Date } | null = null;
  try {
    const copy = await createSandbox({
      club,
      admin,
      secret: cfg.secret,
      signIn: async (key, email, password): Promise<Db> => {
        if (key !== "arun") return ephemeralSignIn(cfg, email, password);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`sign in: ${error.message}`);
        return supabase;
      },
    });
    cookie = { value: signSandboxCookie(cfg.secret, copy.workspaceId, copy.expiresAt), expiresAt: copy.expiresAt };
    outcome = "ok";
  } catch (err) {
    if (err instanceof SandboxLimitError) outcome = err.reason;
    else console.error("loadDemoClub:", err instanceof Error ? err.message : err);
  }

  if (outcome !== "ok" || !cookie) {
    await supabase.auth.signOut({ scope: "local" });
    redirect(`/login?error=copy-${outcome}`);
  }
  jar.set(SANDBOX_COOKIE, cookie.value, sandboxCookieOptions(cookie.expiresAt));
  // A fresh copy replaces the visitor's previous one. The signed cookie proves it was theirs.
  if (previous) {
    const { data: old } = await admin.from("demo_sandboxes").select("id, user_ids").eq("id", previous.workspaceId).maybeSingle();
    if (old) await purgeOne(admin, old).catch(() => {}); // otherwise it expires on schedule
  }
  // Every new copy starts the guided tour at its first stop; the visitor can exit it at any time.
  await setTourCookie({ track: club === "empty" ? "files" : "built", index: 0 });
  redirect(club === "empty" ? "/import?welcome=empty" : "/?welcome=copy");
}

/** Sign back in to the copy named by the visitor's signed cookie, as its outgoing lead. */
export async function returnToDemoClub(): Promise<void> {
  const cfg = sandboxConfig();
  if (!cfg) redirect("/login?error=copy-not-configured");
  const jar = await cookies();
  const saved = readSandboxCookie(cfg.secret, jar.get(SANDBOX_COOKIE)?.value, new Date());
  if (!saved) {
    jar.delete(SANDBOX_COOKIE);
    redirect("/login?error=copy-expired");
  }

  // The copy may have been deleted by its visitor or by the clean-up since the cookie was set.
  const { data: ws, error: wsErr } = await serviceClient(cfg).from("workspaces")
    .select("sandbox_expires_at").eq("id", saved.workspaceId).maybeSingle();
  if (wsErr) redirect("/login?error=copy-failed");
  if (!ws?.sandbox_expires_at || new Date(ws.sandbox_expires_at).getTime() <= Date.now()) {
    jar.delete(SANDBOX_COOKIE);
    redirect("/login?error=copy-expired");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const email = sandboxEmail(saved.workspaceId, "arun");
  const { error } = await supabase.auth.signInWithPassword({ email, password: sandboxPassword(cfg.secret, email) });
  if (error) redirect("/login?error=sign-in-failed");
  redirect("/");
}
