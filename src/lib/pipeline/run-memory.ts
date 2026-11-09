// The whole pipeline in memory, for the eval script and unit tests: the same prompts, model
// calls (through the adapter) and deterministic checks as the database path, with the
// database functions' storage rules (dedupe, duty merging, status rule) mirrored in code.
// The database path (run-pipeline.ts) is what the app uses; this never touches Supabase.

import { levelRank, mostRestrictive } from "../access.ts";
import { generateStructured, type GenerateDeps } from "../llm/adapter.ts";
import type { Usage } from "../llm/types.ts";
import { DUTY_SYSTEM, DutySchema, batchDutyEvents, buildDutyPrompt, dutyCandidates, pastInstanceDays, postProcessDuties, schedule, type DutyQuote, type KeptDuty, type Schedule } from "./cycles.ts";
import { EXTRACTION_SYSTEM, ExtractionSchema, buildExtractionPrompt, chunkEvents, postProcess, type Candidate, type PipelineEvent } from "./extract.ts";
import { DUTY_CONTEXT_SYSTEM, DutyContextSchema, FOLLOWUP_SYSTEM, FollowupSchema, buildFollowupPrompt, postProcessFollowup, type KeptContext, type KeptEvidence } from "./fulfilment.ts";
import { buildIdf, relatedEvents } from "./related.ts";
import { followupStatus, type FollowupStatus } from "./status.ts";
import { DUTIES_TASK, DUTY_CONTEXT_TASK, EXTRACT_TASK, FOLLOWUP_TASK } from "./tasks.ts";
import { trigramSimilarity } from "./text.ts";
import { normaliseForQuote } from "./verify.ts";

export type MemoryCommitment = { candidate: Candidate; evidence: KeptEvidence[]; context: KeptContext[]; status: FollowupStatus };
export type MemoryDuty = { duty: KeptDuty; schedule: Schedule; context: KeptContext[] };
export type MemoryResult = {
  commitments: MemoryCommitment[];
  duties: MemoryDuty[];
  dropped: Record<string, number>;
  usage: Usage;
  calls: number;
};

const sameQuote = (a: DutyQuote, b: DutyQuote) => a.event.id === b.event.id && normaliseForQuote(a.quote) === normaliseForQuote(b.quote);
const maxLevel = (d: KeptDuty) => mostRestrictive(d.quotes.map((q) => q.event.accessLevel ?? "everyone"));

export async function runInMemory(events: PipelineEvent[], deps: GenerateDeps & { today: string }): Promise<MemoryResult> {
  const result: MemoryResult = { commitments: [], duties: [], dropped: {}, usage: { inputTokens: 0, outputTokens: 0 }, calls: 0 };
  const count = (d: Partial<Record<string, number>>) => {
    for (const [k, n] of Object.entries(d)) result.dropped[k] = (result.dropped[k] ?? 0) + (n ?? 0);
  };
  const call = async <T>(p: Promise<{ data: T; usage: Usage; cached: boolean }>): Promise<T> => {
    const r = await p;
    result.calls++;
    if (!r.cached) {
      result.usage.inputTokens += r.usage.inputTokens;
      result.usage.outputTokens += r.usage.outputTokens;
    }
    return r.data;
  };

  // 1. Commitments.
  const seen = new Set<string>();
  for (const chunk of chunkEvents(events)) {
    const { user, refs } = buildExtractionPrompt(chunk);
    const data = await call(generateStructured({ schema: ExtractionSchema, system: EXTRACTION_SYSTEM, user, modelTier: "fast", task: EXTRACT_TASK }, deps));
    const { kept, dropped } = postProcess(data, refs);
    count(dropped);
    for (const c of kept) {
      const key = `${c.event.id}|${normaliseForQuote(c.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.commitments.push({ candidate: c, evidence: [], context: [], status: "open" });
    }
  }

  // 2. Recurring duties, merged like add_recurring_duty(): same level, and a shared quote or similar description.
  //    Batches run least restricted first.
  for (const batch of batchDutyEvents(dutyCandidates(events))) {
    const { user, refs } = buildDutyPrompt(batch);
    const data = await call(generateStructured({ schema: DutySchema, system: DUTY_SYSTEM, user, modelTier: "fast", task: DUTIES_TASK }, deps));
    const { kept, dropped } = postProcessDuties(data, refs);
    count(dropped);
    for (const d of kept) {
      const same = result.duties.find(
        (m) =>
          maxLevel(m.duty) === maxLevel(d) &&
          (m.duty.quotes.some((q) => d.quotes.some((n) => sameQuote(q, n))) ||
            normaliseForQuote(m.duty.description) === normaliseForQuote(d.description) ||
            trigramSimilarity(m.duty.description, d.description) >= 0.55),
      );
      if (same) {
        for (const q of d.quotes) if (!same.duty.quotes.some((s) => sameQuote(s, q))) same.duty.quotes.push(q);
        same.duty.approver ??= d.approver;
        same.duty.approval ??= d.approval;
        same.duty.leadTime ??= d.leadTime;
        continue;
      }
      // Already known at a less restricted level: not stored again (add_recurring_duty does the same).
      const lower = result.duties.find(
        (m) => levelRank(maxLevel(m.duty)) < levelRank(maxLevel(d)) && (normaliseForQuote(m.duty.description) === normaliseForQuote(d.description) || trigramSimilarity(m.duty.description, d.description) >= 0.55),
      );
      if (lower) {
        count({ known_at_lower_level: 1 });
        continue;
      }
      const s = schedule({ period: d.period, whenWords: d.whenWords, leadTime: d.leadTime, pastInstances: pastInstanceDays(d.quotes), today: deps.today });
      result.duties.push({ duty: d, schedule: s, context: [] });
    }
  }

  // 3. Follow-up for every item.
  const idf = buildIdf(events);
  for (const c of result.commitments) {
    const target = {
      obligationId: c.candidate.event.id, kind: "commitment" as const, description: c.candidate.deliverable,
      owedBy: c.candidate.owedBy, owedTo: c.candidate.owedTo, dueText: c.candidate.dueText, cadence: null, approver: null,
      sourceEventIds: [c.candidate.event.id], sourceQuotes: [c.candidate.quote],
    };
    const related = relatedEvents({ text: [target.description, target.owedBy, target.owedTo, c.candidate.quote].join(" "), sourceEventIds: target.sourceEventIds }, events, idf);
    const { user, refs } = buildFollowupPrompt(target, related);
    const data = await call(generateStructured({ schema: FollowupSchema, system: FOLLOWUP_SYSTEM, user, modelTier: "fast", task: FOLLOWUP_TASK }, deps));
    const kept = postProcessFollowup(data, refs, target);
    count(kept.dropped);
    c.evidence = kept.evidence;
    c.context = kept.context;
    c.status = followupStatus([
      { relation: "supports", inferred: false, verified: true },
      ...kept.evidence.map((e) => ({ relation: e.relation, inferred: e.inferred, verified: true })),
    ]);
  }
  for (const d of result.duties) {
    const sources = [...new Set(d.duty.quotes.filter((q) => q.relation === "supports").map((q) => q.event.id))];
    const target = {
      obligationId: sources[0], kind: "recurring" as const, description: d.duty.description, owedBy: d.duty.owedBy, owedTo: null,
      dueText: null, cadence: d.duty.cadence, approver: d.duty.approver, sourceEventIds: sources, sourceQuotes: d.duty.quotes.map((q) => q.quote),
    };
    const related = relatedEvents({ text: [d.duty.description, d.duty.approver, ...target.sourceQuotes].filter(Boolean).join(" "), sourceEventIds: sources }, events, idf);
    const { user, refs } = buildFollowupPrompt(target, related);
    const data = await call(generateStructured({ schema: DutyContextSchema, system: DUTY_CONTEXT_SYSTEM, user, modelTier: "fast", task: DUTY_CONTEXT_TASK }, deps));
    const kept = postProcessFollowup(data, refs, target);
    count(kept.dropped);
    d.context = kept.context;
  }
  return result;
}
