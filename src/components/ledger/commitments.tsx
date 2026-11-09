import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS } from "@/lib/access";
import { formatIst } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TRUST_LABELS = {
  corroborated: "Corroborated",
  sourced: "Sourced",
  inferred: "Inferred",
  contradicted: "Contradicted",
  gap: "Gap: no evidence kept",
} as const;

const REVIEW_LABELS = { draft: "Draft", accepted: "Accepted", rejected: "Rejected", edited: "Edited" } as const;
const STATUS_LABELS = { open: "Open", fulfilled: "Fulfilled", no_evidence: "No evidence kept", contradicted: "Contradicted" } as const;
const TYPE_LABELS = { whatsapp: "WhatsApp", trello: "Trello", minutes: "Minutes" } as const;

/** Commitments this role may read, each with its verified quotes. RLS filters the query. */
export async function Commitments({ workspaceId }: { workspaceId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligations")
    .select("id, description, owed_by, owed_to, due_text, status, trust_state, review_state, access_level, evidence(id, quote, relation, verified, events(ts, author, sources(filename, type)))")
    .eq("workspace_id", workspaceId)
    .eq("kind", "commitment")
    .order("created_at", { ascending: true });

  if (error) return <p role="alert">Could not load commitments. Try again in a minute.</p>;
  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">No commitments yet. Import files, then use “Find commitments”.</p>;
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Commitments" data-testid="commitments">
      {data.map((o) => (
        <li key={o.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{o.description.charAt(0).toUpperCase() + o.description.slice(1)}</p>
            <span className="flex flex-wrap gap-1">
              <Badge variant={o.trust_state === "contradicted" || o.trust_state === "gap" ? "destructive" : "secondary"}>
                Trust: {TRUST_LABELS[o.trust_state]}
              </Badge>
              <Badge variant="outline">{STATUS_LABELS[o.status]}</Badge>
              <Badge variant="outline">{REVIEW_LABELS[o.review_state]}</Badge>
              <Badge variant={o.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[o.access_level]}</Badge>
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {o.owed_by ?? "Someone"} owes {o.owed_to ?? "someone"}
            {o.due_text ? `, ${o.due_text}` : ""}
          </p>
          {o.evidence.length === 0 ? (
            <p className="mt-2">No evidence kept.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {o.evidence.map((ev) => (
                <li key={ev.id}>
                  <blockquote className="border-l-2 pl-3">“{ev.quote}”</blockquote>
                  <p className="mt-1 pl-3 text-xs text-muted-foreground">
                    {ev.events
                      ? `${ev.events.author ?? "Unknown"}, ${formatIst(ev.events.ts)}${ev.events.sources ? ` · ${TYPE_LABELS[ev.events.sources.type]} · ${ev.events.sources.filename}` : ""}`
                      : "Quote shared with your role; the full message is not visible to you."}
                    {ev.verified ? " · quote checked against the message" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
