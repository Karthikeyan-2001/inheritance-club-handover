// The ground truth of a generated scenario (data/scenarios/<name>/ground_truth.yaml) and the check
// that every quote in it is really in its file. SYNTHETIC data only.

import { parse } from "yaml";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access.ts";
import { normaliseForQuote } from "../pipeline/verify.ts";

const Access = z.enum(ACCESS_LEVELS);
const Quote = z.object({ file: z.string(), text: z.string().min(1) });
const Trust = z.enum(["corroborated", "sourced", "inferred", "contradicted", "gap"]);
const Status = z.enum(["fulfilled", "no_evidence", "contradicted", "likely_fulfilled", "open"]);
/** The demo account that uploads a file; private files are readable by it and the advisor only. */
const Uploader = z.enum(["arun", "meena", "kavya", "divya"]);

export const TruthSchema = z.object({
  synthetic: z.literal(true),
  files: z.record(z.string(), z.object({ type: z.enum(["whatsapp", "trello", "minutes"]), accessLevel: Access, uploader: Uploader.default("arun") })),
  commitments: z.array(
    z.object({
      id: z.string(),
      owedBy: z.string(),
      owedTo: z.string(),
      deliverable: z.string(),
      due: z.string().nullable(),
      expectedStatus: Status,
      expectedTrust: Trust.nullable(),
      expectedAccess: Access.optional(),
      note: z.string().optional(),
      quote: Quote,
      /** `inferred`: the record only implies it was done (likely fulfilled, never shown as done). */
      evidence: z.array(Quote.extend({ relation: z.enum(["fulfils", "contradicts"]), inferred: z.boolean().optional() })),
    }),
  ),
  recurring: z.array(
    z.object({
      id: z.string(),
      duty: z.string(),
      cadence: z.string(),
      approval: z.string(),
      approver: z.string().nullable(),
      expectedTrust: Trust,
      /** The level of the copy to score; default committee (a finance copy from the minutes may exist too). */
      expectedAccess: Access.optional(),
      appears: z.array(z.string()),
      quotes: z.array(Quote).min(1),
    }),
  ),
  decoys: z.array(Quote),
  contradictions: z.array(z.object({ id: z.string(), commitment: z.string(), claimA: Quote, claimB: Quote })),
  restricted: z.array(z.object({ level: Access, text: z.string() })),
});
export type Truth = z.infer<typeof TruthSchema>;

export const loadTruth = (yamlText: string): Truth => TruthSchema.parse(parse(yamlText));

/** Texts of each file's events (what the parser produced), keyed by file name. */
export type FileTexts = Record<string, string[]>;

/** Every quote in the truth, with where it sits in the document. */
export function allQuotes(t: Truth): { where: string; quote: z.infer<typeof Quote> }[] {
  return [
    ...t.commitments.flatMap((c) => [{ where: `${c.id} promise`, quote: c.quote }, ...c.evidence.map((e, i) => ({ where: `${c.id} evidence ${i + 1}`, quote: e }))]),
    ...t.recurring.flatMap((r) => r.quotes.map((q, i) => ({ where: `${r.id} quote ${i + 1}`, quote: q }))),
    ...t.decoys.map((q, i) => ({ where: `decoy ${i + 1}`, quote: q })),
    ...t.contradictions.flatMap((x) => [{ where: `${x.id} claim A`, quote: x.claimA }, { where: `${x.id} claim B`, quote: x.claimB }]),
  ];
}

/**
 * Problems with a truth against the parsed files: a quote missing from its file (or in no
 * single event), an unknown file, a restricted amount outside its level, a bad reference.
 */
export function checkTruth(t: Truth, files: FileTexts): string[] {
  const problems: string[] = [];
  for (const { where, quote } of allQuotes(t)) {
    const events = files[quote.file];
    if (!events) problems.push(`${where}: file "${quote.file}" was not generated`);
    else if (!events.some((e) => normaliseForQuote(e).includes(normaliseForQuote(quote.text)))) problems.push(`${where}: quote not found in ${quote.file}: ${quote.text}`);
  }
  const ids = new Set(t.commitments.map((c) => c.id));
  for (const x of t.contradictions) if (!ids.has(x.commitment)) problems.push(`${x.id}: unknown commitment ${x.commitment}`);
  const rank = (l: string) => ACCESS_LEVELS.indexOf(l as (typeof ACCESS_LEVELS)[number]);
  // ACCESS_LEVELS runs from open to closed, so a lower rank is more open.
  for (const r of t.restricted) {
    for (const [file, events] of Object.entries(files)) {
      const fileLevel = t.files[file]?.accessLevel;
      if (fileLevel && rank(fileLevel) < rank(r.level) && events.some((e) => e.includes(r.text))) {
        problems.push(`restricted text ${r.text} (${r.level}) appears in ${file} (${fileLevel})`);
      }
    }
  }
  return problems;
}
