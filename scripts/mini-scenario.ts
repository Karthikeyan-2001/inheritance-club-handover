// The mini scenario (data/scenarios/mini, SYNTHETIC) as pipeline events, for unit tests and
// the eval scripts. Ids are "<file>#<index>"; access levels come from ground-truth.json.

import { readFileSync } from "node:fs";
import type { AccessLevel } from "../src/lib/access.ts";
import { parseUpload } from "../src/lib/parsers/index.ts";
import type { PipelineEvent } from "../src/lib/pipeline/extract.ts";
import type { MatchItem, MatchPair } from "../src/lib/pipeline/match.ts";
import { normaliseForQuote } from "../src/lib/pipeline/verify.ts";

export const MINI_DIR = "data/scenarios/mini/";

export type Quote = { file: string; text: string };
export type MiniTruth = {
  files: Record<string, { type: string; accessLevel: AccessLevel }>;
  commitments: {
    id: string; owedBy: string; owedTo: string; deliverable: string; expectedStatus: string; expectedTrust: string; expectedAccess?: AccessLevel;
    quote: Quote; evidence: (Quote & { relation: "fulfils" | "contradicts" })[];
  }[];
  recurring: { id: string; duty: string; cadence: string; approval: string; approver: string; expectedTrust: string; quotes: Quote[] }[];
  decoys: Quote[];
  contradictions: { id: string; commitment: string; claimA: Quote; claimB: Quote }[];
  matchProbes: {
    extraItems: { id: string; kind: "commitment" | "recurring"; description: string; owedBy?: string; owedTo?: string; approver?: string; cadence?: string; quote: Quote }[];
    pairs: { a: string; b: string; expect: "same" | "different" }[];
  };
};

export type MiniEvent = PipelineEvent & { file: string };

export function miniTruth(): MiniTruth {
  return JSON.parse(readFileSync(MINI_DIR + "ground-truth.json", "utf8")) as MiniTruth;
}

export async function miniEvents(): Promise<MiniEvent[]> {
  const truth = miniTruth();
  const events: MiniEvent[] = [];
  for (const [file, meta] of Object.entries(truth.files)) {
    const r = await parseUpload(file, new Uint8Array(readFileSync(MINI_DIR + file)));
    r.events.forEach((e, i) =>
      events.push({ id: `${file}#${i}`, file, sourceId: file, author: e.author, ts: e.ts, text: e.text, threadId: e.threadId, sourceType: e.sourceType, accessLevel: meta.accessLevel }),
    );
  }
  return events;
}

/** The event a ground-truth quote comes from. */
export function eventFor(events: readonly MiniEvent[], q: Quote): MiniEvent | undefined {
  return events.find((e) => e.file === q.file && normaliseForQuote(e.text).includes(normaliseForQuote(q.text)));
}

/**
 * The fixed matching probe: ground-truth items (duties at their committee-level quotes) and the
 * planted restatements, as MatchItems, and the pairs with the verdict each should get.
 */
export function matchProbe(events: readonly MiniEvent[], truth: MiniTruth): { items: Map<string, MatchItem>; pairs: (MatchPair & { expect: "same" | "different" })[] } {
  const source = (q: Quote) => {
    const e = eventFor(events, q);
    if (!e) throw new Error(`probe quote not found: ${q.text}`);
    return { eventId: e.id, quote: q.text, ts: e.ts, sourceType: e.sourceType };
  };
  const items = new Map<string, MatchItem>();
  for (const c of truth.commitments) {
    items.set(c.id, { id: c.id, kind: "commitment", description: c.deliverable, owedBy: c.owedBy, owedTo: c.owedTo, dueText: null, cadence: null, approver: null, level: truth.files[c.quote.file].accessLevel, sources: [source(c.quote)] });
  }
  for (const r of truth.recurring) {
    const quotes = r.quotes.filter((q) => truth.files[q.file].accessLevel === "committee");
    items.set(r.id, { id: r.id, kind: "recurring", description: r.duty, owedBy: null, owedTo: null, dueText: null, cadence: r.cadence, approver: r.approver, level: "committee", sources: quotes.map(source) });
  }
  for (const x of truth.matchProbes.extraItems) {
    items.set(x.id, {
      id: x.id, kind: x.kind, description: x.description, owedBy: x.owedBy ?? null, owedTo: x.owedTo ?? null, dueText: null,
      cadence: x.cadence ?? null, approver: x.approver ?? null, level: truth.files[x.quote.file].accessLevel, sources: [source(x.quote)],
    });
  }
  return { items, pairs: truth.matchProbes.pairs.map((p) => ({ a: p.a, b: p.b, score: 0, expect: p.expect })) };
}
