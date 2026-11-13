import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/lib/format";
import { capitalise } from "@/lib/ledger-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RULING_NOTE, rulingLabel } from "@/lib/review/labels";
import { TYPE_LABELS } from "./obligation-parts";
import { ErrorState } from "@/components/feedback/error-state";
import { EmptyState } from "@/components/feedback/empty-state";

export type ClaimEvent = { ts: string | null; author: string | null; sources: { filename: string; type: keyof typeof TYPE_LABELS } | null } | null;

export type DocketRow = {
  id: string;
  claim_a_event: string;
  claim_b_event: string;
  summary: string;
  quote_a: string | null;
  quote_b: string | null;
  ruling: string | null;
  reason: string | null;
  ruled_at: string | null;
  origin: "rule" | "manual";
  obligation_id: string | null;
  obligations: { description: string; kind: "commitment" | "recurring" } | null;
  claim_a: ClaimEvent;
  claim_b: ClaimEvent;
};

export const DOCKET_SELECT =
  "id, obligation_id, claim_a_event, claim_b_event, summary, quote_a, quote_b, ruling, reason, ruled_at, origin, created_at, obligations(description, kind), " +
  "claim_a:events!docket_entries_claim_a_event_fkey(ts, author, sources(filename, type)), " +
  "claim_b:events!docket_entries_claim_b_event_fkey(ts, author, sources(filename, type))";

export function Claim({ label, quote, event }: { label: string; quote: string | null; event: ClaimEvent }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <blockquote className="border-l-2 pl-3">{quote ? `“${quote}”` : <span className="text-muted-foreground">No quote kept</span>}</blockquote>
      {event && (
        <p className="mt-1 pl-3 text-xs text-muted-foreground">
          {event.author ?? "Unknown"}, {formatIst(event.ts)}
          {event.sources ? ` · ${TYPE_LABELS[event.sources.type]} · ${event.sources.filename}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Conflicts between records: one says an item was done, another says it was not. RLS returns
 * an entry only when the viewer can read both messages and the item. Items recorded twice can
 * share one conflict; it is shown once, naming both records of the item.
 */
export async function Docket({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("docket_entries").select(DOCKET_SELECT).eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) return <ErrorState title="Could not load the docket">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  const rows = (data ?? []) as unknown as DocketRow[];
  if (!rows.length) {
    return (
      <EmptyState title="No conflicts found" body="That is good news. An item lands here when one record says it was done and another says it was not." />
    );
  }

  const groups = new Map<string, { row: DocketRow; items: string[]; ids: string[]; links: { id: string; tab: string; description: string }[] }>();
  for (const r of rows) {
    const key = `${r.claim_a_event}|${r.claim_b_event}`;
    const g = groups.get(key) ?? { row: r, items: [], ids: [], links: [] };
    g.ids.push(r.id);
    if (r.obligations && !g.items.includes(r.obligations.description)) g.items.push(r.obligations.description);
    if (r.obligation_id && r.obligations && !g.links.some((l) => l.id === r.obligation_id)) g.links.push({ id: r.obligation_id, tab: r.obligations.kind === "recurring" ? "recurring" : "commitments", description: r.obligations.description });
    groups.set(key, g);
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Docket" data-testid="docket">
      {[...groups.values()].map(({ row, items, ids, links }) => (
        <li key={row.id} id={`docket-${row.id}`} className="scroll-mt-4 rounded-md border p-3 text-sm">
          {ids.slice(1).map((id) => (
            <span key={id} id={`docket-${id}`} />
          ))}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{items.length ? items.map(capitalise).join(" / ") : "Conflicting records"}</p>
            <span className="flex flex-wrap gap-1">
              <Badge variant={row.ruling ? "default" : "destructive"}>{row.ruling ? "Ruled" : "Awaiting a ruling"}</Badge>
              <Badge variant="outline">{row.origin === "rule" ? "Found by the trust rule" : "Raised by a reviewer"}</Badge>
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{row.summary}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Claim label="Says it was done" quote={row.quote_a} event={row.claim_a} />
            <Claim label="Says it was not done" quote={row.quote_b} event={row.claim_b} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="docket-ruling">
            {row.ruling ? (
              <>
                Advisor’s ruling: <strong>{rulingLabel(row.ruling)}</strong>
                {row.reason ? ` (${row.reason})` : ""}. {RULING_NOTE}
              </>
            ) : (
              <>
                Not ruled yet. The faculty advisor rules on conflicts in{" "}
                <Link href={`/review?tab=conflicts#docket-${row.id}`} className="underline">
                  Review
                </Link>
                .
              </>
            )}
          </p>
          {links.length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5 text-xs">
              {links.map((l) => (
                <p key={l.id}>
                  <Link href={`/ledger?tab=${l.tab}#item-${l.id}`} className="underline">
                    {links.length > 1 ? `Open “${l.description}” in the ledger` : "Open the item in the ledger"}
                  </Link>
                </p>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
