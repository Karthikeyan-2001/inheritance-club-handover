import "server-only";
import { demoUser, type DemoUserKey } from "@/lib/demo/demo-users";
import { sandboxEmail, sandboxPassword } from "@/lib/demo/sandbox";
import { sandboxConfig } from "@/lib/demo/sandbox-server";
import { getViewer } from "@/lib/session";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SwitchError =
  | "not-configured"
  | "copy-not-configured"
  | "copy-missing"
  | "copy-expired"
  | "sign-in-failed";

/**
 * Sign the cookie session in as one of the four demo accounts. With `club = "mine"` the
 * account is the one of the visitor's own copy (the copy the current session belongs to,
 * read through RLS); otherwise it is the shared demo account. Returns an error code for
 * `/login?error=`, or null when signed in.
 *
 * Not a server action on purpose (it is not in a "use server" file): callers decide which
 * key and club are allowed.
 */
export async function switchDemoUser(key: DemoUserKey, club: "mine" | "shared"): Promise<SwitchError | null> {
  if (!supabasePublicEnv()) return "not-configured";

  let email: string;
  let password: string;
  if (club === "mine") {
    const cfg = sandboxConfig();
    if (!cfg) return "copy-not-configured";
    const viewer = await getViewer();
    const expires = viewer?.membership?.sandboxExpiresAt;
    if (!viewer?.membership || !expires) return "copy-missing";
    if (new Date(expires).getTime() <= Date.now()) return "copy-expired";
    email = sandboxEmail(viewer.membership.workspaceId, key);
    password = sandboxPassword(cfg.secret, email);
  } else {
    const shared = process.env.DEMO_USER_PASSWORD;
    if (!shared) return "not-configured";
    email = demoUser(key).email;
    password = shared;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? "sign-in-failed" : null;
}
