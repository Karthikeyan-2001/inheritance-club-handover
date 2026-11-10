import { Badge } from "@/components/ui/badge";
import { Claim, DOCKET_SELECT, type DocketRow } from "@/components/ledger/docket";
import { formatIst } from "@/lib/format";
import { capitalise } from "@/lib/ledger-view";
import { RULING_LABELS, RULING_NOTE, rulingLabel } from "@/lib/review/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ruleConflict } from "@/app/review/actions";
import { RulingForm } from "./forms";

const OPTIONS = Object.entries(RULING_LABELS).map(([value, label]) => ({ value, label }));

/** Conflicts between records. The advisor rules on each; everyone else reads. */
export async function Conflicts({ workspaceId, canRule }: { workspaceId: string; canRule: boolean }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("docket_entries").select(DOCKET_SELECT).eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) return <p role="alert">Could not load the conflicts. Try again in a minute.</p>;
  const rows = (data ?? []) as unknown as (DocketRow & { ruled_at: string | null })[];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No conflicts. An item lands here when one record says it was done and another says it was not.</p>;
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Conflicts" data-testid="conflicts">
      {rows.map((r) => (
        <li key={r.id} id={`docket-${r.id}`} className="scroll-mt-4 rounded-md border p-3 text-sm" data-testid="conflict">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{r.obligations ? capitalise(r.obligations.description) : "Conflicting records"}</p>
            <Badge variant={r.ruling ? "default" : "destructive"}>{r.ruling ? `Ruled: ${rulingLabel(r.ruling)}` : "Awaiting a ruling"}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{r.summary}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Claim label="Says it was done" quote={r.quote_a} event={r.claim_a} />
            <Claim label="Says it was not done" quote={r.quote_b} event={r.claim_b} />
          </div>
          {r.ruling && (
            <p className="mt-2 text-xs text-muted-foreground">
              Advisor’s ruling: <strong>{rulingLabel(r.ruling)}</strong>
              {r.reason ? ` (${r.reason})` : ""}
              {r.ruled_at ? `, ${formatIst(r.ruled_at)}` : ""}. {RULING_NOTE}
            </p>
          )}
          {canRule ? (
            <div className="mt-3 border-t pt-3">
              <RulingForm action={ruleConflict} entry={r.id} current={r.ruling} options={OPTIONS} />
            </div>
          ) : (
            !r.ruling && <p className="mt-2 text-xs text-muted-foreground">Only the faculty advisor rules on a conflict.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
