import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { capitalise, groupLinked } from "@/lib/ledger-view";
import { loadLinkData } from "./link-data";
import { AlsoRecorded, CONTEXT_SELECT, ContextList, DocketLink, EVIDENCE_SELECT, EvidenceList, PossibleMatches, type ContextRow, type EvidenceRow } from "./obligation-parts";

export const TRUST_LABELS = {
  corroborated: "Corroborated",
  sourced: "Sourced",
  inferred: "Inferred",
  contradicted: "Contradicted",
  gap: "Gap: no evidence kept",
} as const;

/** What each trust state means, in the words of the trust rule (src/lib/pipeline/trust.ts). */
export const TRUST_HELP = {
  corroborated: "Two independent records (different files or different people) agree.",
  sourced: "Backed by one record only.",
  inferred: "Done only by inference: no record says so plainly.",
  contradicted: "One record says it was done and another says it was not. See the Docket.",
  gap: "No verified evidence is kept for this item.",
} as const;

export const REVIEW_LABELS = { draft: "Draft", accepted: "Accepted", rejected: "Rejected", edited: "Edited" } as const;

export const STATUS_LABELS = {
  open: "Open",
  fulfilled: "Done",
  likely_fulfilled: "Likely done (inferred)",
  no_evidence: "No evidence kept",
  contradicted: "Contradicted",
} as const;

type Row = {
  id: string;
  description: string;
  owed_by: string | null;
  owed_to: string | null;
  due_text: string | null;
  status: keyof typeof STATUS_LABELS;
  fulfilment_checked_at: string | null;
  trust_state: keyof typeof TRUST_LABELS;
  review_state: keyof typeof REVIEW_LABELS;
  access_level: AccessLevel;
  evidence: EvidenceRow[];
  context_items: ContextRow[];
};

/** "Open" before any follow-up check is "not yet checked": never silently pending. */
export function statusLabel(status: Row["status"], checkedAt: string | null): string {
  if (status === "open" && !checkedAt) return "Not yet checked for follow-up";
  if (status === "open") return "Open: says it is not done yet";
  return STATUS_LABELS[status];
}

/** Commitments this role may read, each with its verified quotes and context. RLS filters the query. */
export async function Commitments({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligations")
    .select(`id, description, owed_by, owed_to, due_text, status, fulfilment_checked_at, trust_state, review_state, access_level, ${EVIDENCE_SELECT}, ${CONTEXT_SELECT}`)
    .eq("workspace_id", workspaceId)
    .eq("kind", "commitment")
    .order("created_at", { ascending: true });

  if (error) return <p role="alert">Could not load commitments. Try again in a minute.</p>;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No commitments yet. Import files, then use “Build the ledger”.</p>;
  }
  const { links, docketByItem, error: linkError } = await loadLinkData(supabase, workspaceId);
  if (linkError) return <p role="alert">Could not load how items are linked. Try again in a minute.</p>;
  const byId = new Map(rows.map((o) => [o.id, o]));
  const groups = groupLinked(rows.map((o) => o.id), links);

  return (
    <ul className="flex flex-col gap-3" aria-label="Commitments" data-testid="commitments">
      {groups.map((g) => {
        const o = byId.get(g.primary)!;
        return (
          <li key={o.id} id={`item-${o.id}`} className="scroll-mt-4 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{capitalise(o.description)}</p>
              <span className="flex flex-wrap gap-1">
                <Badge variant={o.status === "contradicted" || o.status === "no_evidence" ? "destructive" : o.status === "fulfilled" ? "default" : "outline"}>
                  {statusLabel(o.status, o.fulfilment_checked_at)}
                </Badge>
                <Badge variant={o.trust_state === "contradicted" || o.trust_state === "gap" ? "destructive" : "secondary"}>Trust: {TRUST_LABELS[o.trust_state]}</Badge>
                <Badge variant="outline">{REVIEW_LABELS[o.review_state]}</Badge>
                <Badge variant={o.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[o.access_level]}</Badge>
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {o.owed_by ?? "Someone"} owes {o.owed_to ?? "someone"}
              {o.due_text ? `, ${o.due_text}` : ""}
            </p>
            {o.trust_state === "contradicted" && <p className="mt-1 text-xs text-muted-foreground">{TRUST_HELP.contradicted}</p>}
            <DocketLink entryId={o.trust_state === "contradicted" ? docketByItem.get(o.id) : undefined} />
            <EvidenceList evidence={o.evidence} kind="commitment" />
            <AlsoRecorded
              records={g.also.map((id) => {
                const r = byId.get(id)!;
                return { ...r, statusText: statusLabel(r.status, r.fulfilment_checked_at), statusBad: r.status === "contradicted" || r.status === "no_evidence" };
              })}
              kind="commitment"
              trustLabels={TRUST_LABELS}
              reviewLabels={REVIEW_LABELS}
              docketByItem={docketByItem}
            />
            <PossibleMatches items={g.possible.map((id) => ({ id, description: byId.get(id)!.description }))} />
            <ContextList items={o.context_items} />
          </li>
        );
      })}
    </ul>
  );
}
