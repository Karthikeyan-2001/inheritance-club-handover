import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/lib/format";
import { readiness, type Role } from "@/lib/review/readiness";
import { approveVersion, markReady } from "@/app/review/actions";
import { ReasonForm } from "./forms";

export type Signoff = { marked_at: string; item_count: number; reason: string; is_current: boolean } | null;

/**
 * Where the draft stands: counts, what blocks the next step, and the step itself. The outgoing
 * lead marks the draft ready; the advisor approves a mark that still matches. The database
 * enforces the same rules, so the buttons are a convenience, not the control.
 */
export function SignoffPanel({
  role,
  counts,
  signoff,
  latestNumber,
}: {
  role: Role;
  counts: { draft: number; accepted: number; rejected: number; changed: number; unruled: number };
  signoff: Signoff;
  latestNumber: number | null;
}) {
  const gates = readiness({ role, acceptedCount: counts.accepted, needsRereviewCount: counts.changed, signoff: signoff ? { isCurrent: signoff.is_current } : null });
  return (
    <section aria-label="Sign-off" className="flex flex-col gap-3 rounded-md border p-4 text-sm" data-testid="signoff">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Sign-off</h2>
        <Badge variant="outline">{counts.accepted} accepted</Badge>
        <Badge variant="outline">{counts.draft} draft</Badge>
        <Badge variant="outline">{counts.rejected} rejected</Badge>
        {counts.changed > 0 && <Badge variant="destructive">{counts.changed} changed since accepted</Badge>}
        {counts.unruled > 0 && <Badge variant="secondary">{counts.unruled} {counts.unruled === 1 ? "conflict awaits" : "conflicts await"} a ruling</Badge>}
      </div>
      <p className="text-muted-foreground">
        The outgoing lead checks each item against its quotes and marks the accepted draft ready. The faculty advisor then approves it as a new version, which can never be changed. The
        incoming lead sees only approved versions.
        {latestNumber ? ` The latest approved version is ${latestNumber}.` : " No version has been approved yet."}
      </p>
      <p data-testid="signoff-status">
        {signoff
          ? signoff.is_current
            ? `Marked ready for the advisor on ${formatIst(signoff.marked_at)} (${signoff.item_count} items): “${signoff.reason}”.`
            : `Marked ready on ${formatIst(signoff.marked_at)}, but the draft has changed since. It must be marked ready again.`
          : "Not marked ready yet."}
      </p>
      {counts.unruled > 0 && <p className="text-muted-foreground">Open conflicts do not block approval; they are handed over as “awaiting a ruling”.</p>}

      {role === "outgoing_lead" && (
        <div>
          <h3 className="font-medium">Mark ready for the advisor</h3>
          {gates.markReady.reasons.length > 0 && (
            <ul className="mb-2 list-disc pl-5 text-muted-foreground" aria-label="Why this is not possible yet">
              {gates.markReady.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <ReasonForm action={markReady} buttons={[{ label: "Mark ready for the advisor", value: "mark", variant: "default", disabled: !gates.markReady.ok }]} label="Note for the advisor" placeholder="What did you check?" />
        </div>
      )}
      {role === "advisor" && (
        <div>
          <h3 className="font-medium">Approve a new version</h3>
          {gates.approve.reasons.length > 0 && (
            <ul className="mb-2 list-disc pl-5 text-muted-foreground" aria-label="Why this is not possible yet">
              {gates.approve.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <ReasonForm action={approveVersion} buttons={[{ label: "Approve this version", value: "approve", variant: "default", disabled: !gates.approve.ok }]} label="Reason for approving" placeholder="What did you check?" />
        </div>
      )}
    </section>
  );
}
