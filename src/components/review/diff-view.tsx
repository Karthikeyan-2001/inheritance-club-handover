import { Badge } from "@/components/ui/badge";
import { isEmptyDiff, type VersionDiff } from "@/lib/review/diff";
import { rulingLabel } from "@/lib/review/labels";

const RELATION: Record<string, string> = { supports: "the promise or duty", fulfils: "says it was done", contradicts: "says it was not done", past_instance: "a past time" };
const none = (v: string | null) => v ?? "nothing";

/** What changed between two lists of items, as the viewer's role can read them. */
export function DiffView({ diff, against, empty, stated }: { diff: VersionDiff; against: string; empty?: string; /** Messages that are the outgoing lead's answers to gap questions. */ stated?: ReadonlySet<string> }) {
  if (isEmptyDiff(diff)) {
    return <p className="text-sm text-muted-foreground">{empty ?? `Nothing differs from ${against}.`}</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="diff">
      {diff.added.length > 0 && (
        <section aria-label="New items">
          <h4 className="font-medium">New since {against}</h4>
          <ul className="mt-1 list-disc pl-5">
            {diff.added.map((a) => (
              <li key={a.id}>{a.description}</li>
            ))}
          </ul>
        </section>
      )}
      {diff.removed.length > 0 && (
        <section aria-label="Items no longer included">
          <h4 className="font-medium">No longer included</h4>
          <ul className="mt-1 list-disc pl-5">
            {diff.removed.map((a) => (
              <li key={a.id}>{a.description}</li>
            ))}
          </ul>
        </section>
      )}
      {diff.changed.length > 0 && (
        <section aria-label="Changed items">
          <h4 className="font-medium">Changed since {against}</h4>
          <ul className="mt-1 flex flex-col gap-2">
            {diff.changed.map((c) => (
              <li key={c.id} className="rounded-md border p-2" data-testid="diff-changed">
                <p className="font-medium">{c.description}</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {c.fields.map((f) => (
                    <li key={f.field}>
                      {f.label}: <span className="line-through">{none(f.before)}</span> → <span className="text-foreground">{none(f.after)}</span>
                    </li>
                  ))}
                  {c.quotesAdded.map((q) => (
                    <li key={`a${q.quote}`}>
                      <Badge variant="outline">New quote</Badge> “{q.quote}” ({RELATION[q.relation] ?? q.relation}
                      {stated?.has(q.eventId) ? <span data-testid="diff-stated">, stated by the outgoing lead</span> : null})
                    </li>
                  ))}
                  {c.quotesRemoved.map((q) => (
                    <li key={`r${q.quote}`}>
                      <Badge variant="outline">Quote removed</Badge> “{q.quote}”
                    </li>
                  ))}
                  {c.rulings.map((r, i) => (
                    <li key={i}>
                      Advisor’s ruling: {r.before ? rulingLabel(r.before) : "none"} → {rulingLabel(r.after)}
                    </li>
                  ))}
                  {c.linksAdded.length > 0 && <li>Now also recorded as {c.linksAdded.length === 1 ? "another record" : `${c.linksAdded.length} other records`} of the same item</li>}
                  {c.linksRemoved.length > 0 && <li>No longer linked to {c.linksRemoved.length === 1 ? "one record" : `${c.linksRemoved.length} records`}</li>}
                  {c.notesAdded.map((n) => (
                    <li key={n.id}>
                      <Badge variant="outline">New note</Badge> {n.text}
                    </li>
                  ))}
                  {c.notesRemoved.map((n) => (
                    <li key={n.id}>
                      <Badge variant="outline">Note removed</Badge> {n.text}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.unchanged > 0 && <p className="text-muted-foreground">{diff.unchanged} {diff.unchanged === 1 ? "item" : "items"} unchanged.</p>}
    </div>
  );
}
