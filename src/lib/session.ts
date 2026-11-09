import "server-only";
import type { AppRole } from "./access";
import { createSupabaseServerClient } from "./supabase/server";

export type Viewer = {
  userId: string;
  email: string | null;
  name: string;
  membership: { role: AppRole; workspaceId: string; workspaceName: string } | null;
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
    .select("role, workspace_id, workspaces(name)")
    .eq("user_id", claims.sub)
    .limit(1)
    .maybeSingle();
  if (mErr) throw new Error(`Could not load your membership: ${mErr.message}`);

  const metaName = claims.user_metadata?.name;
  return {
    userId: claims.sub,
    email: claims.email ?? null,
    name: typeof metaName === "string" ? metaName : (claims.email ?? "Signed-in user"),
    membership: m
      ? { role: m.role, workspaceId: m.workspace_id, workspaceName: m.workspaces?.name ?? "Workspace" }
      : null,
  };
}
