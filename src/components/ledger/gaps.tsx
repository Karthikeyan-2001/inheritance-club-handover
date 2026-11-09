import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { capitalise, findGaps, type GapInput } from "@/lib/ledger-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Row = GapInput & { access_level: AccessLevel };

/**
 * What the records do not show: items with no kept evidence, promises with no follow-up, duties
 * with no derivable date. Only items this role may read are considered (RLS filters first), so
 * a gap is a gap in what you can see.
 */
export async function Gaps({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligations")
    .select("id, kind, description, status, trust_state, next_due, fulfilment_checked_at, access_level")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) return <p role="alert">Could not load the gaps. Try again in a minute.</p>;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in the ledger yet. Import files, then use “Build the ledger”.</p>;

  const level = new Map(rows.map((r) => [r.id, r.access_level]));
  const gaps = findGaps(rows);
  if (!gaps.length) {
    return (
      <p className="text-sm" role="status" data-testid="gaps-empty">
        No gaps among the {rows.length} {rows.length === 1 ? "item" : "items"} you can read: each has evidence kept, and every duty has a derivable next date.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" role="status">
        {gaps.length} {gaps.length === 1 ? "gap" : "gaps"} in the items you can read. A gap is shown, never filled in or guessed.
      </p>
      <ul className="flex flex-col gap-3" aria-label="Gaps" data-testid="gaps">
        {gaps.map((g, i) => (
          <li key={`${g.id}-${i}`} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{capitalise(g.description)}</p>
              <span className="flex flex-wrap gap-1">
                <Badge variant="outline">{g.kind === "recurring" ? "Recurring duty" : "Commitment"}</Badge>
                <Badge variant={level.get(g.id) === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[level.get(g.id) ?? "everyone"]}</Badge>
              </span>
            </div>
            <p className="mt-1">{g.what}</p>
            <p className="mt-1 text-xs text-muted-foreground">To close it: {g.closeWith}</p>
            <p className="mt-1 text-xs">
              <Link href={`/ledger?tab=${g.kind === "recurring" ? "recurring" : "commitments"}#item-${g.id}`} className="underline">
                Open the item
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
