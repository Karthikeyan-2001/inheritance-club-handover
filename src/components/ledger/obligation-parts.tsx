import Link from "next/link";
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

function SourceLine({ event, verified, href }: { event: SourceEvent; verified: boolean; href?: string }) {
  return (
    <p className="mt-1 pl-3 text-xs text-muted-foreground">
      {event
        ? `${event.author ?? "Unknown"}, ${formatIst(event.ts)}${event.sources ? ` · ${TYPE_LABELS[event.sources.type]} · ${event.sources.filename}` : ""}`
        : "Quote shared with your role; the full message is not visible to you."}
      {verified ? " · quote checked against the message" : ""}
      {href && (
        <>
          {" · "}
          <Link href={href} className="underline">
            Open source message
          </Link>
        </>
      )}
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
          <SourceLine event={ev.events} verified={ev.verified} href={`/ledger/evidence/${ev.id}`} />
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
                <SourceLine event={c.events} verified={c.verified} href={`/ledger/evidence/${c.id}?kind=context`} />
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

export type LinkRow = { a: string; b: string; verdict: "same" | "possible" };

/** What the grouped cards need from every item (commitment or duty). */
export type CardItem = {
  id: string;
  description: string;
  access_level: AccessLevel;
  trust_state: "corroborated" | "sourced" | "inferred" | "contradicted" | "gap";
  evidence: EvidenceRow[];
};

/** "Also in Trello": where a linked record came from, taken from its own quotes. */
function recordedIn(item: CardItem): string {
  const types = [...new Set(item.evidence.map((e) => e.events?.sources?.type).filter((t): t is keyof typeof TYPE_LABELS => Boolean(t)))];
  return types.length ? `Also in ${types.map((t) => TYPE_LABELS[t]).join(" and ")}` : "Also recorded";
}

/**
 * Other records of the same item, folded into its card, each with its own access level and
 * quotes. RLS already removed any record the viewer cannot read.
 */
export function AlsoRecorded({ records, kind, trustLabels }: { records: CardItem[]; kind: "commitment" | "recurring"; trustLabels: Record<CardItem["trust_state"], string> }) {
  if (records.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="links">
      {records.map((r) => (
        <section key={r.id} className="rounded-sm border border-dashed p-2" aria-label={recordedIn(r)}>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{recordedIn(r)}</span>
            <Badge variant={r.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[r.access_level]}</Badge>
            <Badge variant="outline">Trust: {trustLabels[r.trust_state]}</Badge>
          </p>
          <p className="mt-1">{r.description.charAt(0).toUpperCase() + r.description.slice(1)}</p>
          <EvidenceList evidence={r.evidence} kind={kind} />
        </section>
      ))}
    </div>
  );
}

/** Possible matches: a quiet note. They are never merged and never used as evidence. */
export function PossibleMatches({ items }: { items: { id: string; description: string }[] }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground" data-testid="possible-matches">
      <span className="font-medium uppercase tracking-wide">Possible match (not used as evidence): </span>
      {items.map((i) => `“${i.description}”`).join("; ")}
    </p>
  );
}

/** A contradicted item points at its conflict; the Docket points back. */
export function DocketLink({ entryId }: { entryId: string | undefined }) {
  if (!entryId) return null;
  return (
    <p className="mt-2 text-xs">
      <Link href={`/ledger?tab=docket#docket-${entryId}`} className="underline">
        See this conflict in the Docket
      </Link>
    </p>
  );
}
