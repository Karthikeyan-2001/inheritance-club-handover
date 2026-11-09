// The mini scenario (data/scenarios/mini, SYNTHETIC) as pipeline events, for unit tests and
// the eval scripts. Ids are "<file>#<index>"; access levels come from ground-truth.json.

import { readFileSync } from "node:fs";
import type { AccessLevel } from "../src/lib/access.ts";
import { parseUpload } from "../src/lib/parsers/index.ts";
import type { PipelineEvent } from "../src/lib/pipeline/extract.ts";
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
