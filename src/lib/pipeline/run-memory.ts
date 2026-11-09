// The whole pipeline in memory, for the eval script and unit tests: the same prompts, model
// calls (through the adapter) and deterministic checks as the database path, with the
// database functions' storage rules (dedupe, duty merging, provenance, matching, the status
// and trust rules over effective evidence) mirrored in code.
// The database path (run-pipeline.ts) is what the app uses; this never touches Supabase.

import { levelRank, mostRestrictive, type AccessLevel } from "../access.ts";
import { generateStructured, type GenerateDeps } from "../llm/adapter.ts";
import type { Usage } from "../llm/types.ts";
import { DUTY_SYSTEM, DutySchema, batchDutyEvents, buildDutyPrompt, dutyCandidates, pastInstanceDays, postProcessDuties, schedule, type DutyQuote, type KeptDuty, type Schedule } from "./cycles.ts";
import { EXTRACTION_SYSTEM, ExtractionSchema, buildExtractionPrompt, chunkEvents, postProcess, type Candidate, type PipelineEvent } from "./extract.ts";
import { DUTY_CONTEXT_SYSTEM, DutyContextSchema, FOLLOWUP_SYSTEM, FollowupSchema, buildFollowupPrompt, postProcessFollowup, type KeptContext, type KeptEvidence } from "./fulfilment.ts";
import { MATCH_SYSTEM, MatchSchema, batchPairs, buildMatchPrompt, planMatches, postProcessMatches, type Alias, type MatchItem } from "./match.ts";
import { buildIdf, relatedEvents } from "./related.ts";
import { followupStatus, type FollowupStatus, type StatusEvidence } from "./status.ts";
import { DUTIES_TASK, DUTY_CONTEXT_TASK, EXTRACT_TASK, FOLLOWUP_TASK, MATCH_TASK } from "./tasks.ts";
import { canBorrow, trustState, type TrustEvidence, type TrustState, type Visibility } from "./trust.ts";
import { trigramSimilarity } from "./text.ts";
import { normaliseForQuote } from "./verify.ts";

type Settled = { id: string; level: AccessLevel; trust: TrustState };
export type MemoryCommitment = Settled & { candidate: Candidate; evidence: KeptEvidence[]; context: KeptContext[]; status: FollowupStatus };
export type MemoryDuty = Settled & { duty: KeptDuty; schedule: Schedule; context: KeptContext[] };
export type MemoryLink = { a: string; b: string; verdict: "same" | "possible"; method: "rule" | "model" };
export type MemoryResult = {
  commitments: MemoryCommitment[];
  duties: MemoryDuty[];
  links: MemoryLink[];
  dropped: Record<string, number>;
  usage: Usage;
  calls: number;
};

const sameQuote = (a: DutyQuote, b: DutyQuote) => a.event.id === b.event.id && normaliseForQuote(a.quote) === normaliseForQuote(b.quote);
const maxLevel = (d: KeptDuty) => mostRestrictive(d.quotes.map((q) => q.event.accessLevel ?? "everyone"));

const levelOf = (e: PipelineEvent): AccessLevel => e.accessLevel ?? "everyone";

/** An item's level and private uploaders: the most restrictive of the messages it cites (provenance). */
function visibilityOf(cited: readonly PipelineEvent[]): Visibility {
  const level = mostRestrictive(cited.map(levelOf));
  const privateUploaders = [...new Set(cited.filter((e) => levelOf(e) === "private").map((e) => e.uploaderId ?? "unknown"))];
  return { level, privateUploaders };
}

const trustEvidence = (e: PipelineEvent, relation: TrustEvidence["relation"], inferred = false): TrustEvidence => ({
  relation, inferred, verified: true, eventId: e.id, sourceId: e.sourceId ?? e.sourceType, author: e.author,
});

export async function runInMemory(events: PipelineEvent[], deps: GenerateDeps & { today: string; aliases?: readonly Alias[] }): Promise<MemoryResult> {
  const result: MemoryResult = { commitments: [], duties: [], links: [], dropped: {}, usage: { inputTokens: 0, outputTokens: 0 }, calls: 0 };
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
      result.commitments.push({ id: `c${result.commitments.length + 1}`, level: levelOf(c.event), trust: "sourced", candidate: c, evidence: [], context: [], status: "open" });
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
      result.duties.push({ id: `d${result.duties.length + 1}`, level: maxLevel(d), trust: "sourced", duty: d, schedule: s, context: [] });
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

  // 4. Matching, as plan_matches and match_items do: rule links first, then the model's verdicts.
  const own = new Map<string, { vis: Visibility; trust: TrustEvidence[] }>();
  const items: MatchItem[] = [];
  for (const c of result.commitments) {
    const vis = visibilityOf([c.candidate.event, ...c.evidence.map((e) => e.event)]);
    c.level = vis.level;
    own.set(c.id, { vis, trust: [trustEvidence(c.candidate.event, "supports"), ...c.evidence.map((e) => trustEvidence(e.event, e.relation, e.inferred))] });
    items.push({
      id: c.id, kind: "commitment", description: c.candidate.deliverable, owedBy: c.candidate.owedBy, owedTo: c.candidate.owedTo, dueText: c.candidate.dueText,
      cadence: null, approver: null, level: vis.level,
      sources: [{ eventId: c.candidate.event.id, quote: c.candidate.quote, ts: c.candidate.event.ts, sourceType: c.candidate.event.sourceType }],
    });
  }
  for (const d of result.duties) {
    const vis = visibilityOf(d.duty.quotes.map((q) => q.event));
    own.set(d.id, { vis, trust: d.duty.quotes.map((q) => trustEvidence(q.event, q.relation)) });
    items.push({
      id: d.id, kind: "recurring", description: d.duty.description, owedBy: d.duty.owedBy, owedTo: null, dueText: null,
      cadence: d.duty.cadence, approver: d.duty.approver, level: vis.level,
      sources: d.duty.quotes.filter((q) => q.relation === "supports").map((q) => ({ eventId: q.event.id, quote: q.quote, ts: q.event.ts, sourceType: q.event.sourceType })),
    });
  }
  const plan = planMatches(items, deps.aliases ?? []);
  if (plan.overLimit) count({ match_over_limit: plan.overLimit });
  const link = (a: string, b: string, verdict: MemoryLink["verdict"], method: MemoryLink["method"]) => {
    const existing = result.links.find((l) => l.a === a && l.b === b);
    if (!existing) result.links.push({ a, b, verdict, method });
    else if (existing.verdict === "possible" && verdict === "same") Object.assign(existing, { verdict, method });
  };
  for (const p of plan.rule) link(p.a, p.b, "same", "rule");
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const batch of batchPairs(plan.ask)) {
    const { user, refs } = buildMatchPrompt(batch, byId);
    const data = await call(generateStructured({ schema: MatchSchema, system: MATCH_SYSTEM, user, modelTier: "fast", task: MATCH_TASK }, deps));
    const kept = postProcessMatches(data, refs);
    count(kept.dropped);
    for (const p of kept.same) link(p.a, p.b, "same", "model");
    for (const p of kept.possible) link(p.a, p.b, "possible", "model");
  }

  // 5. Trust and status over effective evidence (app.effective_evidence, app.trust_rule, app.status_rule).
  const effective = (id: string): TrustEvidence[] => {
    const mine = own.get(id)!;
    const borrowed = result.links
      .filter((l) => l.verdict === "same" && (l.a === id || l.b === id))
      .map((l) => own.get(l.a === id ? l.b : l.a)!)
      .filter((o) => canBorrow(mine.vis, o.vis))
      .flatMap((o) => o.trust);
    return [...mine.trust, ...borrowed];
  };
  for (const c of result.commitments) {
    const ev = effective(c.id);
    c.trust = trustState(ev);
    c.status = followupStatus(ev as StatusEvidence[]);
  }
  for (const d of result.duties) d.trust = trustState(effective(d.id));
  return result;
}
