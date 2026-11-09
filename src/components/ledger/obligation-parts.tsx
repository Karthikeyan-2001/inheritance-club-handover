import { Badge } from "@/components/ui/badge";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { formatIst } from "@/lib/format";

export const TYPE_LABELS = { whatsapp: "WhatsApp", trello: "Trello", minutes: "Minutes" } as const;

type SourceEvent = { ts: string | null; author: string | null; sources: { filename: string; type: keyof typeof TYPE_LABELS } | null } | null;

export type EvidenceRow = {
  id: string;
  quote: string;
  relation: "supports" | "fulfils" | "contradicts" | "past_instance";
  verified: boolean;
  inferred: boolean;
  events: SourceEvent;
};

export type ContextRow = {
  id: string;
  kind: "decision" | "contact" | "risk" | "dependency";
  text: string;
  quote: string | null;
  verified: boolean;
  access_level: AccessLevel;
  events: SourceEvent;
};

function relationLabel(e: EvidenceRow, kind: "commitment" | "recurring"): string {
  switch (e.relation) {
    case "supports":
      return kind === "commitment" ? "The promise" : "States the duty";
    case "fulfils":
      return e.inferred ? "Suggests it was done (inferred)" : "Says it was done";
    case "contradicts":
      return "Says it was not done";
    case "past_instance":
      return "A past time it happened";
  }
}

const ORDER = { supports: 0, past_instance: 1, fulfils: 2, contradicts: 3 } as const;

function SourceLine({ event, verified }: { event: SourceEvent; verified: boolean }) {
  return (
    <p className="mt-1 pl-3 text-xs text-muted-foreground">
      {event
        ? `${event.author ?? "Unknown"}, ${formatIst(event.ts)}${event.sources ? ` · ${TYPE_LABELS[event.sources.type]} · ${event.sources.filename}` : ""}`
        : "Quote shared with your role; the full message is not visible to you."}
      {verified ? " · quote checked against the message" : ""}
    </p>
  );
}

/** Verified quotes behind an obligation, labelled by what each one shows. */
export function EvidenceList({ evidence, kind }: { evidence: EvidenceRow[]; kind: "commitment" | "recurring" }) {
  if (evidence.length === 0) return <p className="mt-2">No evidence kept.</p>;
  const sorted = [...evidence].sort((a, b) => ORDER[a.relation] - ORDER[b.relation] || (a.events?.ts ?? "").localeCompare(b.events?.ts ?? ""));
  return (
    <ul className="mt-2 flex flex-col gap-2" aria-label="Evidence">
      {sorted.map((ev) => (
        <li key={ev.id} data-relation={ev.relation}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{relationLabel(ev, kind)}</p>
          <blockquote className="border-l-2 pl-3">“{ev.quote}”</blockquote>
          <SourceLine event={ev.events} verified={ev.verified} />
        </li>
      ))}
    </ul>
  );
}

const CONTEXT_LABELS = { decision: "Decision", contact: "Contact", risk: "Risk", dependency: "Depends on" } as const;

/** Context notes the viewer may read (each has its own access level; RLS filtered them). */
export function ContextList({ items }: { items: ContextRow[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What to know</p>
      <ul className="mt-1 flex flex-col gap-2" aria-label="Context">
        {items.map((c) => (
          <li key={c.id} className="rounded-sm bg-muted/50 p-2">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{CONTEXT_LABELS[c.kind]}</Badge>
              <span>{c.text}</span>
              {c.access_level !== "everyone" && <Badge variant="secondary">{ACCESS_LABELS[c.access_level]}</Badge>}
            </p>
            {c.quote && (
              <>
                <blockquote className="mt-1 border-l-2 pl-3">“{c.quote}”</blockquote>
                <SourceLine event={c.events} verified={c.verified} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const EVIDENCE_SELECT = "evidence(id, quote, relation, verified, inferred, events(ts, author, sources(filename, type)))";
export const CONTEXT_SELECT = "context_items(id, kind, text, quote, verified, access_level, events(ts, author, sources(filename, type)))";
