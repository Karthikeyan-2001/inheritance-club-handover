import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REVIEW_LABELS, TRUST_HELP, TRUST_LABELS } from "./commitments";
import { CONTEXT_SELECT, ContextList, EVIDENCE_SELECT, EvidenceList, LinkList, linksByItem, type ContextRow, type EvidenceRow, type LinkRow } from "./obligation-parts";

const PERIOD_LABELS = {
  semester: "Every semester",
  year: "Every year",
  month: "Every month",
  week: "Every week",
  each_time: "Every time",
  other: "Repeats",
} as const;

type Row = {
  id: string;
  description: string;
  owed_by: string | null;
  period: keyof typeof PERIOD_LABELS | null;
  cadence: string | null;
  approval_required: string | null;
  approver: string | null;
  lead_time: string | null;
  next_due: string | null;
  start_by: string | null;
  next_due_basis: string | null;
  trust_state: keyof typeof TRUST_LABELS;
  review_state: keyof typeof REVIEW_LABELS;
  access_level: AccessLevel;
  evidence: EvidenceRow[];
  context_items: ContextRow[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2027-01-01" -> "1 Jan 2027" (calendar dates, no time zone). */
function day(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const NOT_STATED = <span className="text-muted-foreground">Not stated in the records</span>;

/** Recurring duties this role may read, with approvals, timing and verified quotes. RLS filters the query. */
export async function Recurring({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligations")
    .select(
      `id, description, owed_by, period, cadence, approval_required, approver, lead_time, next_due, start_by, next_due_basis, trust_state, review_state, access_level, ${EVIDENCE_SELECT}, ${CONTEXT_SELECT}`,
    )
    .eq("workspace_id", workspaceId)
    .eq("kind", "recurring")
    .order("created_at", { ascending: true });

  if (error) return <p role="alert">Could not load recurring duties. Try again in a minute.</p>;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No recurring duties yet. Import files, then use “Build the ledger”.</p>;
  }
  const { data: links } = await supabase.from("obligation_links").select("a, b, verdict").eq("workspace_id", workspaceId);
  const linked = linksByItem((links ?? []) as LinkRow[], new Map(rows.map((o) => [o.id, o.description])));

  return (
    <ul className="flex flex-col gap-3" aria-label="Recurring duties" data-testid="recurring">
      {rows.map((o) => (
        <li key={o.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{o.description.charAt(0).toUpperCase() + o.description.slice(1)}</p>
            <span className="flex flex-wrap gap-1">
              <Badge variant={o.trust_state === "contradicted" || o.trust_state === "gap" ? "destructive" : "secondary"}>Trust: {TRUST_LABELS[o.trust_state]}</Badge>
              <Badge variant="outline">{REVIEW_LABELS[o.review_state]}</Badge>
              <Badge variant={o.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[o.access_level]}</Badge>
            </span>
          </div>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <Fact label="How often">
              {o.period ? PERIOD_LABELS[o.period] : "Repeats"}
              {o.cadence ? <span className="text-muted-foreground"> (“{o.cadence}”)</span> : null}
            </Fact>
            <Fact label="Approval needed">
              {o.approval_required || o.approver ? (
                <>
                  {o.approval_required ?? "Approval"}
                  {o.approver ? `, from ${o.approver}` : ""}
                </>
              ) : (
                "None mentioned"
              )}
            </Fact>
            <Fact label="Start ahead">{o.lead_time ?? NOT_STATED}</Fact>
            <Fact label="Usually done by">{o.owed_by ?? NOT_STATED}</Fact>
            <Fact label="Next due">
              {o.next_due ? (
                <>
                  {o.next_due_basis?.startsWith("Estimated") ? "About " : ""}
                  {day(o.next_due)}
                  {o.start_by ? `; start by ${day(o.start_by)}` : ""}
                  {o.next_due_basis && <span className="block text-xs text-muted-foreground">{o.next_due_basis}</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Not derivable from the records</span>
              )}
            </Fact>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Trust: {TRUST_HELP[o.trust_state]}</p>
          <EvidenceList evidence={o.evidence} kind="recurring" />
          <LinkList items={linked.get(o.id)} />
          <ContextList items={o.context_items} />
        </li>
      ))}
    </ul>
  );
}
