import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { capitalise } from "@/lib/ledger-view";
import { diffVersions, type DiffRow, type VersionItem } from "@/lib/review/diff";
import { editableFields, isDateField, type Kind } from "@/lib/review/fields";
import { needsRereview, rereviewChange } from "@/lib/review/rereview";
import type { Role } from "@/lib/review/readiness";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { editItem, reviewItem, setLinkVerdict } from "@/app/review/actions";
import { loadLinkData } from "@/components/ledger/link-data";
import { CONTEXT_SELECT, ContextList, EVIDENCE_SELECT, EvidenceList, type ContextRow, type EvidenceRow } from "@/components/ledger/obligation-parts";
import { REVIEW_LABELS, STATUS_LABELS, TRUST_LABELS, statusLabel } from "@/components/ledger/commitments";
import { DiffView } from "./diff-view";
import { EditForm, ReasonForm } from "./forms";
import { SignoffPanel, type Signoff } from "./signoff-panel";
import { loadLatestVersion, loadVersionRows } from "./version-data";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ErrorState } from "@/components/feedback/error-state";

type Row = {
  id: string;
  kind: Kind;
  description: string;
  owed_by: string | null;
  owed_to: string | null;
  due_text: string | null;
  due_date: string | null;
  cadence: string | null;
  approval_required: string | null;
  approver: string | null;
  lead_time: string | null;
  next_due: string | null;
  start_by: string | null;
  status: keyof typeof STATUS_LABELS;
  trust_state: keyof typeof TRUST_LABELS;
  review_state: keyof typeof REVIEW_LABELS;
  reviewed_status: keyof typeof STATUS_LABELS | null;
  reviewed_trust: keyof typeof TRUST_LABELS | null;
  fulfilment_checked_at: string | null;
  access_level: AccessLevel;
  evidence: EvidenceRow[];
  context_items: ContextRow[];
};

const SELECT =
  "id, kind, description, owed_by, owed_to, due_text, due_date, cadence, approval_required, approver, lead_time, next_due, start_by, status, trust_state, review_state, reviewed_status, reviewed_trust, fulfilment_checked_at, access_level, " +
  `${EVIDENCE_SELECT}, ${CONTEXT_SELECT}`;

function facts(o: Row): string {
  if (o.kind === "commitment") return `${o.owed_by ?? "Someone"} owes ${o.owed_to ?? "someone"}${o.due_text ? `, ${o.due_text}` : ""}`;
  const parts = [o.owed_by ? `Owed by ${o.owed_by}` : null, o.cadence, o.approval_required ? `needs ${o.approval_required}${o.approver ? ` from ${o.approver}` : ""}` : null, o.next_due ? `next due ${o.next_due}` : null];
  return parts.filter(Boolean).join(" · ") || "No details stated";
}

const label = (s: string | null, map: Record<string, string>) => (s ? (map[s] ?? s) : "nothing");

function Links({ item, links, byId }: { item: Row; links: { a: string; b: string; verdict: "same" | "possible" | "distinct" }[]; byId: Map<string, Row> }) {
  const mine = links.filter((l) => (l.a === item.id || l.b === item.id) && byId.has(l.a === item.id ? l.b : l.a));
  if (mine.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2" aria-label="Linked records">
      {mine.map((l) => {
        const other = byId.get(l.a === item.id ? l.b : l.a)!;
        const text = l.verdict === "same" ? "Recorded as the same item as" : l.verdict === "possible" ? "Might be the same item as" : "You ruled out as the same item:";
        return (
          <li key={`${l.a}${l.b}`} className="rounded-sm bg-muted/50 p-2">
            <p>
              {text} “{capitalise(other.description)}”
            </p>
            <ReasonForm
              action={setLinkVerdict}
              hidden={{ a: item.id, b: other.id }}
              buttonName="verdict"
              label="Reason"
              buttons={[
                ...(l.verdict !== "same" ? [{ label: "Same item", value: "same" }] : []),
                ...(l.verdict !== "distinct" ? [{ label: "Not the same", value: "distinct" }] : []),
              ]}
            />
          </li>
        );
      })}
    </ul>
  );
}

function ItemCard({ o, links, byId }: { o: Row; links: { a: string; b: string; verdict: "same" | "possible" | "distinct" }[]; byId: Map<string, Row> }) {
  const changed = needsRereview(o);
  const move = rereviewChange(o);
  const state = o.review_state;
  const buttons =
    state === "draft"
      ? [{ label: "Accept", value: "accept", variant: "default" as const }, { label: "Reject", value: "reject", variant: "destructive" as const }]
      : state === "rejected"
        ? [{ label: "Back to draft", value: "reopen" }]
        : [
            ...(changed ? [{ label: "Accept again", value: "accept", variant: "default" as const }] : []),
            { label: "Reject", value: "reject", variant: "destructive" as const },
            { label: "Back to draft", value: "reopen" },
          ];
  return (
    <li id={`item-${o.id}`} className="scroll-mt-4 rounded-md border p-3 text-sm" data-testid="review-item" data-state={state} data-changed={changed ? "true" : "false"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{capitalise(o.description)}</p>
        <span className="flex flex-wrap gap-1">
          <Badge variant={state === "accepted" || state === "edited" ? "default" : state === "rejected" ? "destructive" : "outline"}>{REVIEW_LABELS[state]}</Badge>
          {o.kind === "commitment" && <Badge variant="outline">{statusLabel(o.status, o.fulfilment_checked_at)}</Badge>}
          <Badge variant={o.trust_state === "contradicted" || o.trust_state === "gap" ? "destructive" : "secondary"}>Trust: {TRUST_LABELS[o.trust_state]}</Badge>
          <Badge variant={o.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[o.access_level]}</Badge>
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">{facts(o)}</p>
      {changed && (
        <p role="note" className="mt-2 rounded-sm border border-destructive/50 p-2" data-testid="changed-since-accepted">
          <strong>Changed since accepted.</strong>
          {move.status && ` Status was ${label(move.status.was, STATUS_LABELS)}, now ${label(move.status.now, STATUS_LABELS)}.`}
          {move.trust && ` Trust was ${label(move.trust.was, TRUST_LABELS)}, now ${label(move.trust.now, TRUST_LABELS)}.`} Check the quotes, then accept it again or reject it. Nothing can be marked ready or approved until you do.
        </p>
      )}
      <EvidenceList evidence={o.evidence} kind={o.kind} />
      <ContextList items={o.context_items} />
      <Links item={o} links={links} byId={byId} />
      <div className="mt-3 flex flex-col gap-3 border-t pt-3">
        <ReasonForm action={reviewItem} hidden={{ id: o.id }} buttons={buttons} />
        {state !== "rejected" && (
          <EditForm
            action={editItem}
            id={o.id}
            fields={editableFields(o.kind).map((name) => ({ name, value: String((o as unknown as Record<string, string | null>)[name] ?? ""), date: isDateField(name) }))}
          />
        )}
      </div>
    </li>
  );
}

function Section({ title, hint, rows, links, byId, testId }: { title: string; hint?: string; rows: Row[]; links: Parameters<typeof Links>[0]["links"]; byId: Map<string, Row>; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">
        {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h3>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">None right now.</p> : <ul className="flex flex-col gap-3">{rows.map((o) => <ItemCard key={o.id} o={o} links={links} byId={byId} />)}</ul>}
    </section>
  );
}

/** The working ledger for review: every item the reviewer may read, grouped by what it needs. */
export async function Draft({ role, workspaceId }: { role: Role; workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const [obligations, linkData, signoffRes, docket, latest, pending] = await Promise.all([
    supabase.from("obligations").select(SELECT).eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    loadLinkData(supabase, workspaceId),
    supabase.rpc("signoff_status", { p_workspace: workspaceId }),
    supabase.from("docket_entries").select("id, ruling").eq("workspace_id", workspaceId),
    loadLatestVersion(supabase, workspaceId),
    supabase.rpc("pending_review", { p_workspace: workspaceId }),
  ]);
  if (obligations.error || linkData.error || signoffRes.error || docket.error || latest.error || pending.error) {
    return <ErrorState title="Could not load the draft">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  }
  const rows = (obligations.data ?? []) as unknown as Row[];
  if (rows.length === 0) {
    return <EmptyState title="Nothing to review yet" body="The ledger has no items. Add files and build the ledger first.">
        <Button asChild size="sm">
          <Link href="/ledger">Go to the ledger</Link>
        </Button>
      </EmptyState>;
  }
  const byId = new Map(rows.map((o) => [o.id, o]));
  const changed = rows.filter(needsRereview);
  const drafts = rows.filter((o) => o.review_state === "draft");
  const accepted = rows.filter((o) => (o.review_state === "accepted" || o.review_state === "edited") && !needsRereview(o));
  const rejected = rows.filter((o) => o.review_state === "rejected");
  const counts = {
    draft: drafts.length,
    accepted: accepted.length + changed.length,
    rejected: rejected.length,
    changed: changed.length,
    unruled: (docket.data ?? []).filter((d) => !d.ruling).length,
  };

  // The pending diff: what the next version would hold against the last, as this role reads both.
  let prevRows: DiffRow[] | null = null;
  if (latest.version) {
    const prev = await loadVersionRows(supabase, latest.version.id);
    if (prev.error) return <ErrorState title="Could not load the latest version">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
    prevRows = prev.rows;
  }
  const notesBy = new Map(rows.map((o) => [o.id, o.context_items.map((c) => ({ id: c.id, kind: c.kind, text: c.text }))]));
  const nextRows: DiffRow[] = (pending.data ?? []).map((p) => ({ obligation_id: p.obligation_id, item: p.item as unknown as VersionItem, notes: notesBy.get(p.obligation_id) ?? [] }));
  const diff = diffVersions(prevRows, nextRows);
  const signoff = (signoffRes.data?.[0] ?? null) as Signoff;

  return (
    <div className="flex flex-col gap-6">
      <SignoffPanel role={role} counts={counts} signoff={signoff} latestNumber={latest.version?.number ?? null} />

      <section aria-label="Pending changes" className="flex flex-col gap-2 rounded-md border p-4" data-testid="pending-diff">
        <h2 className="text-lg font-semibold">{latest.version ? `What the next version changes from version ${latest.version.number}` : "What the first version would contain"}</h2>
        {nextRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No item is accepted yet, so there is nothing to hand over.</p>
        ) : (
          <DiffView diff={diff} against={latest.version ? `version ${latest.version.number}` : "nothing"} empty={`Nothing differs from version ${latest.version?.number}.`} />
        )}
      </section>

      <Section title="Changed since accepted" hint="The records moved after you accepted these. Look again before they go any further." rows={changed} links={linkData.links} byId={byId} testId="group-changed" />
      <Section title="Draft" hint="Found by the pipeline. Nothing here is handed over until you accept it." rows={drafts} links={linkData.links} byId={byId} testId="group-draft" />
      <Section title="Accepted" rows={accepted} links={linkData.links} byId={byId} testId="group-accepted" />
      <Section title="Rejected" hint="Kept on record, left out of every version." rows={rejected} links={linkData.links} byId={byId} testId="group-rejected" />
    </div>
  );
}
