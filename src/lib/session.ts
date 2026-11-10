import "server-only";
import type { AppRole } from "./access";
import { DEMO_USERS, type DemoUserKey } from "./demo/demo-users";
import { demoKeyFromMetadata } from "./demo/sandbox";
import { createSupabaseServerClient } from "./supabase/server";

export type Viewer = {
  userId: string;
  email: string | null;
  name: string;
  /** Which demo person this account is (Arun, Dr. Meena, ...), in the shared club or a copy. */
  demoKey: DemoUserKey | null;
  membership: {
    role: AppRole;
    workspaceId: string;
    workspaceName: string;
    /** Set when the workspace is a visitor's own copy of the demo club. */
    sandboxExpiresAt: string | null;
  } | null;
};

/**
 * Data access layer for "who is looking". Returns null when signed out.
 * The identity comes from a verified JWT (getClaims), never from client input.
 */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims;

  const { data: m, error: mErr } = await supabase
    .from("memberships")
    .select("role, workspace_id, workspaces(name, sandbox_expires_at)")
    .eq("user_id", claims.sub)
    .limit(1)
    .maybeSingle();
  if (mErr) throw new Error(`Could not load your membership: ${mErr.message}`);

  const metaName = claims.user_metadata?.name;
  const email = claims.email ?? null;
  return {
    userId: claims.sub,
    email,
    name: typeof metaName === "string" ? metaName : (email ?? "Signed-in user"),
    demoKey: demoKeyFromMetadata(claims.user_metadata) ?? DEMO_USERS.find((u) => u.email === email)?.key ?? null,
    membership: m
      ? {
          role: m.role,
          workspaceId: m.workspace_id,
          workspaceName: m.workspaces?.name ?? "Workspace",
          sandboxExpiresAt: m.workspaces?.sandbox_expires_at ?? null,
        }
      : null,
  };
}
