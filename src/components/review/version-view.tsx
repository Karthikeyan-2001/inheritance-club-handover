import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { formatIst } from "@/lib/format";
import { capitalise } from "@/lib/ledger-view";
import { diffVersions } from "@/lib/review/diff";
import { rulingLabel, RULING_NOTE } from "@/lib/review/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STATUS_LABELS, TRUST_LABELS, statusLabel } from "@/components/ledger/commitments";
import { DiffView } from "./diff-view";
import { loadVersionRows } from "./version-data";
import { ErrorState } from "@/components/feedback/error-state";
import { loadQuoteSources } from "@/components/check/stated";

const RELATION: Record<string, string> = { supports: "The promise or duty", fulfils: "Says it was done", contradicts: "Says it was not done", past_instance: "A past time it happened" };
const KIND = { decision: "Decision", contact: "Contact", risk: "Risk", dependency: "Depends on" } as const;

type Ob = Record<string, string | null>;

function facts(o: Ob): string {
  if (o.kind === "commitment") return `${o.owed_by ?? "Someone"} owes ${o.owed_to ?? "someone"}${o.due_text ? `, ${o.due_text}` : ""}`;
  const parts = [o.owed_by ? `Owed by ${o.owed_by}` : null, o.cadence, o.approval_required ? `needs ${o.approval_required}${o.approver ? ` from ${o.approver}` : ""}` : null, o.next_due ? `next due ${o.next_due}` : null];
  return parts.filter(Boolean).join(" · ") || "No details stated";
}

/** One approved version as this role may read it, with what changed since the one before. */
export async function VersionView({ workspaceId, number }: { workspaceId: string; number: number }) {
  const supabase = await createSupabaseServerClient();
  const { data: versions, error } = await supabase.from("versions").select("id, number, created_at").eq("workspace_id", workspaceId).in("number", [number, number - 1]);
  if (error) return <ErrorState title="Could not load this version">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  const version = versions?.find((v) => v.number === number);
  if (!version) return <p>There is no version {number} in this workspace.</p>;
  const previous = versions?.find((v) => v.number === number - 1) ?? null;

  const [current, before] = await Promise.all([loadVersionRows(supabase, version.id), previous ? loadVersionRows(supabase, previous.id) : Promise.resolve(null)]);
  if (current.error || before?.error) return <ErrorState title="Could not load this version">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  const diff = diffVersions(before?.rows ?? null, current.rows);
  const notes = new Map(current.rows.map((r) => [r.obligation_id, r.notes ?? []]));
  const quoted = await loadQuoteSources(supabase, current.rows.flatMap((r) => r.item.evidence.map((e) => e.event_id)));
  if (quoted.error) return <ErrorState title="Could not load this version">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  const stated = new Set([...quoted.sources].filter(([, s]) => s.type === "statement").map(([id]) => id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Version {version.number}</h2>
        <p className="text-sm text-muted-foreground">
          Approved by the faculty advisor on {formatIst(version.created_at)}. It can never be changed. {current.rows.length} {current.rows.length === 1 ? "item" : "items"} you can read.
        </p>
      </div>

      <section aria-label="Changes" className="flex flex-col gap-2 rounded-md border p-4">
        <h3 className="text-base font-semibold">{previous ? `What changed from version ${previous.number}` : "Everything in this first version"}</h3>
        <DiffView diff={diff} against={previous ? `version ${previous.number}` : "nothing"} empty={`Nothing you can read differs from version ${previous?.number}.`} stated={stated} />
      </section>

      {current.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">This version holds nothing your role is allowed to read.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Items in this version" data-testid="version-items">
          {current.rows.map((r) => {
            const o = r.item.obligation as Ob;
            const kind = o.kind === "recurring" ? "recurring" : "commitment";
            const trust = o.trust_state as keyof typeof TRUST_LABELS;
            return (
              <li key={r.obligation_id} className="rounded-md border p-3 text-sm" data-testid="version-item">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">{capitalise(o.description ?? "")}</p>
                  <span className="flex flex-wrap gap-1">
                    {kind === "commitment" && o.status && <Badge variant="outline">{statusLabel(o.status as keyof typeof STATUS_LABELS, o.fulfilment_checked_at ?? null)}</Badge>}
                    {trust in TRUST_LABELS && <Badge variant={trust === "contradicted" || trust === "gap" ? "destructive" : "secondary"}>Trust: {TRUST_LABELS[trust]}</Badge>}
                    <Badge variant={o.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[(o.access_level ?? "everyone") as AccessLevel]}</Badge>
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{facts(o)}</p>
                {r.item.evidence.length === 0 ? (
                  <p className="mt-2">No evidence kept.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2" aria-label="Evidence">
                    {r.item.evidence.map((e, i) => (
                      <li key={i}>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {e.relation === "fulfils" && e.inferred ? "Suggests it was done (inferred)" : (RELATION[e.relation] ?? e.relation)}
                          {stated.has(e.event_id) && <span className="normal-case tracking-normal"> · Stated by the outgoing lead</span>}
                        </p>
                        <blockquote className="border-l-2 pl-3">“{e.quote}”</blockquote>
                      </li>
                    ))}
                  </ul>
                )}
                {(r.item.conflicts ?? []).map((c) => (
                  <p key={c.id} className="mt-2 rounded-sm border p-2" data-testid="version-conflict">
                    <strong>Conflict between records.</strong> {c.summary}{" "}
                    {c.ruling ? (
                      <>
                        Advisor’s ruling: <strong>{rulingLabel(c.ruling)}</strong>
                        {c.reason ? ` (${c.reason})` : ""}. {RULING_NOTE}
                      </>
                    ) : (
                      "Awaiting a ruling."
                    )}
                  </p>
                ))}
                {(notes.get(r.obligation_id) ?? []).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What to know</p>
                    <ul className="mt-1 flex flex-col gap-1" aria-label="Context">
                      {(notes.get(r.obligation_id) ?? []).map((n) => (
                        <li key={n.id} className="rounded-sm bg-muted/50 p-2">
                          <Badge variant="outline">{KIND[n.kind as keyof typeof KIND] ?? n.kind}</Badge> {n.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm">
        <Link href="/review?tab=versions" className="underline">
          Back to all versions
        </Link>
      </p>
    </div>
  );
}
