import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type AppRole } from "@/lib/access";
import { formatIst } from "@/lib/format";
import { actionLabel, describeChanges, REVIEW_ACTIONS } from "@/lib/review/history";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LIMIT = 100;

/** Review actions the viewer may read from the audit log: who, what, why, and what changed. */
export async function History({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const [audit, members, items] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, actor, action, obligation_id, reason, before, after, created_at")
      .eq("workspace_id", workspaceId)
      .in("action", [...REVIEW_ACTIONS])
      .order("id", { ascending: false })
      .limit(LIMIT),
    supabase.from("memberships").select("user_id, role").eq("workspace_id", workspaceId),
    supabase.from("obligations").select("id, description").eq("workspace_id", workspaceId),
  ]);
  if (audit.error || members.error || items.error) return <p role="alert">Could not load the history. Try again in a minute.</p>;
  const rows = audit.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No review actions yet. Every accept, edit, rejection, ruling, mark and approval will be listed here with its reason.</p>;
  const role = new Map((members.data ?? []).map((m) => [m.user_id, ROLE_LABELS[m.role as AppRole]]));
  const title = new Map((items.data ?? []).map((o) => [o.id, o.description]));
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" aria-label="Review history" data-testid="history">
        {rows.map((r) => {
          const changes = describeChanges(r);
          return (
            <li key={r.id} className="rounded-md border p-3 text-sm" data-testid="history-row" data-action={r.action}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{actionLabel(r.action)}</Badge>
                <span className="font-medium">{r.actor ? (role.get(r.actor) ?? "Someone who has left the workspace") : "The system"}</span>
                <span className="text-muted-foreground">{formatIst(r.created_at)}</span>
              </div>
              {r.obligation_id && <p className="mt-1">{title.get(r.obligation_id) ?? "An item you can no longer read"}</p>}
              {r.reason && <p className="mt-1 text-muted-foreground">Reason: “{r.reason}”</p>}
              {changes.length > 0 && (
                <ul className="mt-1 text-muted-foreground">
                  {changes.map((c) => (
                    <li key={c.label}>
                      {c.label}: <span className="line-through">{c.before}</span> → <span className="text-foreground">{c.after}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length === LIMIT && <p className="text-xs text-muted-foreground">Showing the latest {LIMIT} actions.</p>}
    </div>
  );
}
