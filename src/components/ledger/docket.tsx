import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TYPE_LABELS } from "./obligation-parts";

type ClaimEvent = { ts: string | null; author: string | null; sources: { filename: string; type: keyof typeof TYPE_LABELS } | null } | null;

type Row = {
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

const SELECT =
  "id, obligation_id, claim_a_event, claim_b_event, summary, quote_a, quote_b, ruling, reason, ruled_at, origin, created_at, obligations(description, kind), " +
  "claim_a:events!docket_entries_claim_a_event_fkey(ts, author, sources(filename, type)), " +
  "claim_b:events!docket_entries_claim_b_event_fkey(ts, author, sources(filename, type))";

function Claim({ label, quote, event }: { label: string; quote: string | null; event: ClaimEvent }) {
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

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Conflicts between records: one says an item was done, another says it was not. RLS returns
 * an entry only when the viewer can read both messages and the item. Items recorded twice can
 * share one conflict; it is shown once, naming both records of the item.
 */
export async function Docket({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("docket_entries").select(SELECT).eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) return <p role="alert">Could not load the docket. Try again in a minute.</p>;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No conflicts found. An item lands here when one record says it was done and another says it was not.
      </p>
    );
  }

  const groups = new Map<string, { row: Row; items: string[]; ids: string[]; links: { id: string; tab: string }[] }>();
  for (const r of rows) {
    const key = `${r.claim_a_event}|${r.claim_b_event}`;
    const g = groups.get(key) ?? { row: r, items: [], ids: [], links: [] };
    g.ids.push(r.id);
    if (r.obligations && !g.items.includes(r.obligations.description)) g.items.push(r.obligations.description);
    if (r.obligation_id && r.obligations) g.links.push({ id: r.obligation_id, tab: r.obligations.kind === "recurring" ? "recurring" : "commitments" });
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
          <p className="mt-2 text-xs text-muted-foreground">
            {row.ruling ? `Ruling: ${row.ruling}${row.reason ? ` (${row.reason})` : ""}` : "Not ruled yet. The faculty advisor rules on conflicts during review."}
          </p>
          {links.length > 0 && (
            <p className="mt-1 text-xs">
              <Link href={`/ledger?tab=${links[0].tab}#item-${links[0].id}`} className="underline">
                Open the item in the ledger
              </Link>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
