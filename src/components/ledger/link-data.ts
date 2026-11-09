import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LinkRow } from "./obligation-parts";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Links between items and docket entries per item, both filtered by RLS for the viewer. */
export async function loadLinkData(supabase: Client, workspaceId: string): Promise<{ links: LinkRow[]; docketByItem: Map<string, string[]>; error: boolean }> {
  const [links, docket] = await Promise.all([
    supabase.from("obligation_links").select("a, b, verdict").eq("workspace_id", workspaceId),
    // Open conflicts first, then the newest, so an item's first link is the one to act on.
    supabase
      .from("docket_entries")
      .select("id, obligation_id")
      .eq("workspace_id", workspaceId)
      .order("ruled_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("id"),
  ]);
  const docketByItem = new Map<string, string[]>();
  for (const d of docket.data ?? []) if (d.obligation_id) docketByItem.set(d.obligation_id, [...(docketByItem.get(d.obligation_id) ?? []), d.id]);
  return { links: (links.data ?? []) as LinkRow[], docketByItem, error: Boolean(links.error || docket.error) };
}
