import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DiffRow, Note, VersionItem } from "@/lib/review/diff";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type VersionRow = { id: string; number: number; created_at: string; approved_by: string | null };

/** The items of one version that the viewer's role may read (RLS filters), oldest item first. */
export async function loadVersionRows(supabase: Client, versionId: string): Promise<{ rows: DiffRow[]; error: boolean }> {
  const [items, notes] = await Promise.all([
    supabase.from("version_items").select("obligation_id, item").eq("version_id", versionId),
    supabase.from("version_context_items").select("obligation_id, context_item_id, kind, text").eq("version_id", versionId).order("context_item_id"),
  ]);
  const notesBy = new Map<string, Note[]>();
  for (const n of notes.data ?? []) notesBy.set(n.obligation_id, [...(notesBy.get(n.obligation_id) ?? []), { id: n.context_item_id, kind: n.kind, text: n.text }]);
  const rows = (items.data ?? []).map((r) => {
    const item = r.item as unknown as VersionItem;
    return { obligation_id: r.obligation_id, item, notes: item.format === 2 ? (notesBy.get(r.obligation_id) ?? []) : undefined };
  });
  const created = (r: DiffRow) => String(r.item.obligation.created_at ?? "");
  rows.sort((a, b) => created(a).localeCompare(created(b)) || a.obligation_id.localeCompare(b.obligation_id));
  return { rows, error: Boolean(items.error || notes.error) };
}

/** The latest approved version, or null before the first. */
export async function loadLatestVersion(supabase: Client, workspaceId: string): Promise<{ version: VersionRow | null; error: boolean }> {
  const { data, error } = await supabase.from("versions").select("id, number, created_at, approved_by").eq("workspace_id", workspaceId).order("number", { ascending: false }).limit(1);
  return { version: data?.[0] ?? null, error: Boolean(error) };
}
