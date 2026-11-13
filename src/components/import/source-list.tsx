import { removeSource } from "@/app/import/actions";
import { ActionForm } from "@/components/action-form";
import { ReadSummaryView } from "@/components/import/import-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, ROLE_LABELS, type AppRole } from "@/lib/access";
import { formatIst } from "@/lib/format";
import type { ReadSummary } from "@/lib/parsers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorState } from "@/components/feedback/error-state";

const TYPE_LABELS = { whatsapp: "WhatsApp chat", trello: "Trello board", minutes: "Minutes" } as const;

/** Files this role can see (RLS-filtered), with what was read from each. */
export async function SourceList({ workspaceId, viewerId, viewerRole }: { workspaceId: string; viewerId: string; viewerRole: AppRole }) {
  const supabase = await createSupabaseServerClient();
  const [{ data: sources, error }, { data: members }] = await Promise.all([
    supabase
      .from("sources")
      .select("id, filename, type, access_level, uploaded_by, imported_at, event_count, read_summary")
      .eq("workspace_id", workspaceId)
      .order("imported_at", { ascending: false }),
    supabase.from("memberships").select("user_id, role").eq("workspace_id", workspaceId),
  ]);
  if (error) return <ErrorState title="Could not load the imported files">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  if (!sources?.length) return <EmptyState title="No files imported yet" body="Files you are allowed to read appear here once they are imported." />;

  const roleOf = new Map((members ?? []).map((m) => [m.user_id, m.role as AppRole]));
  return (
    <ul className="flex flex-col gap-3" aria-label="Imported files">
      {sources.map((s) => {
        const summary = s.read_summary as unknown as Partial<ReadSummary>; // jsonb written by importFiles; may be {} for seeded rows
        const mine = s.uploaded_by === viewerId;
        const uploader = mine ? "you" : s.uploaded_by && roleOf.get(s.uploaded_by) ? ROLE_LABELS[roleOf.get(s.uploaded_by)!].toLowerCase() : "a former member";
        const canRemove = mine || viewerRole === "advisor";
        return (
          <li key={s.id} className="rounded-xl border bg-card p-4 text-sm" data-testid="source-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium break-all">{s.filename}</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{TYPE_LABELS[s.type]}</Badge>
                <Badge variant={s.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[s.access_level]}</Badge>
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {s.event_count} entries · imported {formatIst(s.imported_at)} by {uploader}
            </p>
            {summary.unit && summary.rawUnits !== undefined && (
              <details className="mt-2">
                <summary className="cursor-pointer">What was read</summary>
                <ReadSummaryView summary={{ dropped: {}, warnings: [], first: null, last: null, eventCount: s.event_count, ...summary } as ReadSummary} />
              </details>
            )}
            {canRemove && (
              <details className="mt-2">
                <summary className="cursor-pointer">Remove this file…</summary>
                <ActionForm action={removeSource} submitLabel="Remove file and its messages" variant="destructive" className="mt-2 flex flex-col gap-2" confirm={{ title: `Remove ${s.filename}?`, description: "Its messages are removed from the ledger sources, and items that rest only on them lose their evidence. The removal and your reason stay in the audit log.", confirmLabel: "Yes, remove the file" }}>
                  <input type="hidden" name="sourceId" value={s.id} />
                  <label className="flex flex-col gap-1">
                    Reason (kept in the audit log)
                    <input name="reason" required minLength={3} className="rounded-md border bg-background px-2 py-1" />
                  </label>
                </ActionForm>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
