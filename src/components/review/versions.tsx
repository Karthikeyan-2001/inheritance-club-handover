import Link from "next/link";
import { formatIst } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";

/** Approved versions. The item count is what this role can read, never the total. */
export async function Versions({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const [versions, items] = await Promise.all([
    supabase.from("versions").select("id, number, created_at").eq("workspace_id", workspaceId).order("number", { ascending: false }),
    supabase.from("version_items").select("version_id").eq("workspace_id", workspaceId),
  ]);
  if (versions.error || items.error) return <ErrorState title="Could not load the versions">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  if (!versions.data?.length) {
    return <EmptyState title="No version approved yet" body="The outgoing lead checks the draft and marks it ready; the faculty advisor then approves it. Approved versions appear here and can never change." />;
  }
  const count = new Map<string, number>();
  for (const i of items.data ?? []) count.set(i.version_id, (count.get(i.version_id) ?? 0) + 1);
  return (
    <ul className="flex flex-col gap-2" aria-label="Approved versions" data-testid="versions">
      {versions.data.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
          <span>
            <Link href={`/review/versions/${v.number}`} className="font-medium underline">
              Version {v.number}
            </Link>
            <span className="text-muted-foreground"> · approved by the faculty advisor on {formatIst(v.created_at)}</span>
          </span>
          <span className="text-muted-foreground">{count.get(v.id) ?? 0} items you can read</span>
        </li>
      ))}
    </ul>
  );
}
