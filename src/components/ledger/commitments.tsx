import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CONTEXT_SELECT, ContextList, EVIDENCE_SELECT, EvidenceList, LinkList, linksByItem, type ContextRow, type EvidenceRow, type LinkRow } from "./obligation-parts";

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

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const { data: links } = await supabase.from("obligation_links").select("a, b, verdict").eq("workspace_id", workspaceId);
  const linked = linksByItem((links ?? []) as LinkRow[], new Map(rows.map((o) => [o.id, o.description])));

  return (
    <ul className="flex flex-col gap-3" aria-label="Commitments" data-testid="commitments">
      {rows.map((o) => (
        <li key={o.id} className="rounded-md border p-3 text-sm">
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
          <p className="mt-1 text-xs text-muted-foreground">Trust: {TRUST_HELP[o.trust_state]}</p>
          <EvidenceList evidence={o.evidence} kind="commitment" />
          <LinkList items={linked.get(o.id)} />
          <ContextList items={o.context_items} />
        </li>
      ))}
    </ul>
  );
}
