// Database side of the pipeline, run as the signed-in user: RLS applies to every read and
// write, so the model only ever sees rows that user may read. A run is a set of small jobs in
// stages (see tasks.ts); the browser drives it by calling run-next, one job per request, so
// each serverless step stays short. Job payloads and results hold ids and counts, never text.

import type { SupabaseClient } from "@supabase/supabase-js";
import { istDayKey } from "../format.ts";
import { generateStructured } from "../llm/adapter.ts";
import { LlmError } from "../llm/errors.ts";
import type { LlmCache, LlmProvider, Usage } from "../llm/types.ts";
import type { Database, Json } from "../supabase/database.types.ts";
import { DUTY_SYSTEM, DutySchema, batchDutyEvents, buildDutyPrompt, dutyCandidates, pastInstanceDays, postProcessDuties, schedule } from "./cycles.ts";
import { EXTRACTION_SYSTEM, ExtractionSchema, buildExtractionPrompt, chunkEvents, postProcess, type PipelineEvent } from "./extract.ts";
import {
  DUTY_CONTEXT_SYSTEM,
  DutyContextSchema,
  FOLLOWUP_SYSTEM,
  FollowupSchema,
  buildFollowupPrompt,
  postProcessFollowup,
  type FollowupTarget,
} from "./fulfilment.ts";
import { MATCH_SYSTEM, MatchSchema, batchPairs, buildMatchPrompt, pairKey, planMatches, postProcessMatches, type MatchItem, type MatchPair } from "./match.ts";
import { buildIdf, relatedEvents } from "./related.ts";
import { emptyProgress, type RunProgress, type StepResult } from "./progress.ts";
import { DUTIES_TASK, DUTY_CONTEXT_TASK, EXTRACT_TASK, FOLLOWUP_TASK, MATCH_TASK, PLAN_FOLLOWUPS_TASK, PLAN_MATCHES_TASK, STAGES, type JobKind } from "./tasks.ts";

type Db = SupabaseClient<Database>;

export const MAX_STEPS_PER_RUN = 600;
const MAX_ATTEMPTS = 3;
const PAGE = 1000;

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

const EVENT_COLUMNS = "id, author, ts, text, thread_id, access_level, sources(type, uploaded_by)";
type EventRow = {
  id: string; author: string | null; ts: string | null; text: string; thread_id: string | null;
  access_level: PipelineEvent["accessLevel"]; sources: { type: PipelineEvent["sourceType"]; uploaded_by: string | null } | null;
};

const toEvent = (r: EventRow): PipelineEvent => ({
  id: r.id,
  author: r.author,
  ts: r.ts,
  text: r.text,
  threadId: r.thread_id,
  sourceType: r.sources?.type ?? "whatsapp",
  accessLevel: r.access_level,
  uploaderId: r.sources?.uploaded_by ?? null,
});

/** Every event the caller may read in the workspace, oldest first. */
export async function loadReadableEvents(db: Db, workspaceId: string): Promise<PipelineEvent[]> {
  const out: PipelineEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("ts", { ascending: true, nullsFirst: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read messages: ${error.message}`);
    out.push(...(data as EventRow[]).map(toEvent));
    if (!data || data.length < PAGE) return out;
  }
}

async function loadEvents(db: Db, ids: string[]): Promise<PipelineEvent[]> {
  const byId = new Map<string, PipelineEvent>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("events").select(EVENT_COLUMNS).in("id", ids.slice(i, i + 150));
    if (error) throw new Error(`Could not read messages: ${error.message}`);
    for (const r of data as EventRow[]) byId.set(r.id, toEvent(r));
  }
  // Keep the planned order; events removed (or no longer readable) since planning are skipped.
  return ids.map((id) => byId.get(id)).filter((e): e is PipelineEvent => Boolean(e));
}

type JobRow = { workspace_id: string; kind: JobKind; payload: { [key: string]: Json } };

async function insertJobs(db: Db, rows: JobRow[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("jobs").insert(rows.slice(i, i + 100));
    if (error) throw new PlanError(error.code === "42501" ? "Only the outgoing lead or the advisor can build the ledger." : "Could not start the run.");
  }
}

const job = (workspaceId: string, runId: string, userId: string, kind: JobKind, chunk: number, of: number, extra: Record<string, Json> = {}): JobRow => ({
  workspace_id: workspaceId,
  kind,
  payload: { run_id: runId, requested_by: userId, stage: STAGES[kind], chunk, of, ...extra },
});

/**
 * Queue a run: commitments (one job per chunk), recurring duties (one job per batch of
 * candidate messages), a planning job that queues the follow-up checks once the first two
 * stages are done, and a planning job that matches items once they have been checked.
 * Payloads hold ids only, never text.
 */
export async function planRun(db: Db, workspaceId: string, userId: string): Promise<{ runId: string; total: number }> {
  const events = await loadReadableEvents(db, workspaceId);
  if (events.length === 0) throw new PlanError("There are no imported messages you can read yet. Import files first.");
  const chunks = chunkEvents(events);
  const batches = batchDutyEvents(dutyCandidates(events));
  const steps = chunks.length + batches.length + 2;
  if (steps > MAX_STEPS_PER_RUN) throw new PlanError(`That is too much to read in one run (${steps} steps, limit ${MAX_STEPS_PER_RUN}).`);
  const runId = crypto.randomUUID();
  const rows = [
    ...chunks.map((c, i) => job(workspaceId, runId, userId, EXTRACT_TASK, i + 1, chunks.length, { event_ids: c.events.map((e) => e.id) })),
    ...batches.map((b, i) => job(workspaceId, runId, userId, DUTIES_TASK, i + 1, batches.length, { event_ids: b.map((e) => e.id) })),
    job(workspaceId, runId, userId, PLAN_FOLLOWUPS_TASK, 1, 1),
    job(workspaceId, runId, userId, PLAN_MATCHES_TASK, 1, 1),
  ];
  await insertJobs(db, rows);
  return { runId, total: rows.length };
}

export type { RunProgress, StageProgress, StepResult } from "./progress.ts";

export async function getRunProgress(db: Db, workspaceId: string, runId: string): Promise<RunProgress> {
  const { data } = await db.from("jobs").select("kind, status, result").eq("workspace_id", workspaceId).eq("payload->>run_id", runId);
  const p = emptyProgress();
  for (const j of data ?? []) {
    const stage = p.stages[j.kind as JobKind];
    if (!stage) continue;
    p.total++;
    stage.total++;
    const bucket = j.status === "done" ? "done" : j.status === "failed" ? "failed" : "pending";
    p[bucket]++;
    stage[bucket]++;
    const r = (j.result ?? null) as Partial<StepResult> | null;
    if (j.status !== "done" || !r) continue;
    stage.created += r.created ?? 0;
    stage.duplicates += r.duplicates ?? 0;
    stage.candidates += r.candidates ?? 0;
    if (r.cached) p.cachedSteps++;
    p.usage.inputTokens += r.usage?.inputTokens ?? 0;
    p.usage.outputTokens += r.usage?.outputTokens ?? 0;
    for (const [k, n] of Object.entries(r.dropped ?? {})) p.dropped[k] = (p.dropped[k] ?? 0) + n;
    p.followup.evidence += r.evidenceAdded ?? 0;
    p.followup.context += r.contextAdded ?? 0;
    p.matching.same += r.linked ?? 0;
    p.matching.possible += r.possible ?? 0;
    if (r.status) p.followup.statuses[r.status] = (p.followup.statuses[r.status] ?? 0) + 1;
  }
  return p;
}

export type RunDeps = {
  provider: LlmProvider;
  cache: LlmCache;
  env?: Record<string, string | undefined>;
  /** Today as an IST calendar day (YYYY-MM-DD), for next-due dates. Defaults to now. */
  today?: string;
};

type Payload = { chunk: number; of: number; event_ids?: string[]; obligation_id?: string; pairs?: [string, string, number][] };

type StepContext = { db: Db; workspaceId: string; runId: string; userId: string; payload: Payload; deps: RunDeps; step: StepResult };

const llmDeps = (deps: RunDeps) => ({ provider: deps.provider, cache: deps.cache, env: deps.env });

function noteModel(step: StepResult, res: { cached: boolean; model: string; usage: Usage }) {
  step.cached = res.cached;
  step.model = res.model;
  step.usage = res.cached ? { inputTokens: 0, outputTokens: 0 } : res.usage;
}

async function extractStep({ db, workspaceId, payload, deps, step }: StepContext) {
  const events = await loadEvents(db, payload.event_ids ?? []);
  if (events.length === 0) return;
  const { user, refs } = buildExtractionPrompt({ events });
  const res = await generateStructured({ schema: ExtractionSchema, system: EXTRACTION_SYSTEM, user, modelTier: "fast", task: EXTRACT_TASK }, llmDeps(deps));
  noteModel(step, res);
  step.candidates = res.data.commitments.length;
  const { kept, dropped } = postProcess(res.data, refs);
  step.dropped = dropped as Record<string, number>;
  for (const c of kept) {
    const { data, error } = await db.rpc("add_extracted_commitment", {
      p_workspace: workspaceId, p_event: c.event.id, p_quote: c.quote, p_owed_by: c.owedBy,
      p_owed_to: c.owedTo, p_deliverable: c.deliverable, p_due_text: c.dueText ?? "",
    });
    if (error) step.rejected++;
    else if (data?.[0]?.created) step.created++;
    else step.duplicates++;
  }
}

async function dutiesStep({ db, workspaceId, payload, deps, step }: StepContext) {
  const events = await loadEvents(db, payload.event_ids ?? []);
  if (events.length === 0) return;
  const { user, refs } = buildDutyPrompt(events);
  const res = await generateStructured({ schema: DutySchema, system: DUTY_SYSTEM, user, modelTier: "fast", task: DUTIES_TASK }, llmDeps(deps));
  noteModel(step, res);
  step.candidates = res.data.duties.length;
  const { kept, dropped } = postProcessDuties(res.data, refs);
  step.dropped = dropped as Record<string, number>;
  const today = deps.today ?? istDayKey(new Date().toISOString());
  for (const d of kept) {
    const s = schedule({ period: d.period, whenWords: d.whenWords, leadTime: d.leadTime, pastInstances: pastInstanceDays(d.quotes), today });
    const { data, error } = await db.rpc("add_recurring_duty", {
      p_workspace: workspaceId, p_description: d.description, p_period: d.period, p_cadence: d.cadence,
      p_approval: d.approval ?? "", p_approver: d.approver ?? "", p_lead_time: d.leadTime ?? "", p_owed_by: d.owedBy ?? "",
      // Postgres takes null for an absent date; the generated types say string.
      p_next_due: s.nextDue as string, p_start_by: s.startBy as string, p_next_due_basis: s.basis ?? "",
      p_quotes: d.quotes.map((q) => ({ event_id: q.event.id, quote: q.quote, relation: q.relation })),
    });
    if (error) step.rejected++;
    else if (data?.[0]?.created) step.created++;
    else step.duplicates++;
  }
}

type ObligationRow = {
  id: string; kind: "commitment" | "recurring"; description: string; owed_by: string | null; owed_to: string | null;
  due_text: string | null; cadence: string | null; approver: string | null;
  evidence: { event_id: string; relation: string; quote: string }[];
};
const OBLIGATION_COLUMNS = "id, kind, description, owed_by, owed_to, due_text, cadence, approver, evidence(event_id, relation, quote)";

function targetOf(o: ObligationRow): FollowupTarget {
  const supports = o.evidence.filter((e) => e.relation === "supports");
  return {
    obligationId: o.id, kind: o.kind, description: o.description, owedBy: o.owed_by, owedTo: o.owed_to, dueText: o.due_text,
    cadence: o.cadence, approver: o.approver, sourceEventIds: [...new Set(supports.map((e) => e.event_id))], sourceQuotes: supports.map((e) => e.quote),
  };
}

/** Queue one follow-up check per obligation the caller may read, with its related messages. */
async function planFollowupsStep({ db, workspaceId, runId, userId, step }: StepContext) {
  const { data, error } = await db.from("obligations").select(OBLIGATION_COLUMNS).eq("workspace_id", workspaceId).neq("review_state", "rejected").order("created_at");
  if (error) throw new Error(`Could not read obligations: ${error.message}`);
  const events = await loadReadableEvents(db, workspaceId);
  const readable = new Set(events.map((e) => e.id));
  const idf = buildIdf(events);
  const rows: JobRow[] = [];
  let skipped = 0;
  const obligations = (data ?? []) as unknown as ObligationRow[];
  for (const o of obligations) {
    const t = targetOf(o);
    t.sourceEventIds = t.sourceEventIds.filter((id) => readable.has(id));
    if (t.sourceEventIds.length === 0) {
      skipped++;
      continue;
    }
    const related = relatedEvents({ text: [t.description, t.owedBy, t.owedTo, t.approver, ...t.sourceQuotes].filter(Boolean).join(" "), sourceEventIds: t.sourceEventIds }, events, idf);
    rows.push(job(workspaceId, runId, userId, FOLLOWUP_TASK, rows.length + 1, 0, { obligation_id: o.id, event_ids: related.map((e) => e.id) }));
  }
  for (const r of rows) r.payload.of = rows.length;
  await insertJobs(db, rows);
  step.planned = rows.length;
  if (skipped) step.dropped = { source_not_readable: skipped };
}

async function followupStep({ db, workspaceId, payload, deps, step }: StepContext) {
  const { data, error } = await db.from("obligations").select(OBLIGATION_COLUMNS).eq("id", payload.obligation_id ?? "").maybeSingle();
  if (error) throw new Error(`Could not read the obligation: ${error.message}`);
  if (!data) return; // removed or no longer readable since planning
  const target = targetOf(data as unknown as ObligationRow);
  const events = await loadEvents(db, payload.event_ids ?? []);
  if (events.length === 0) return;
  const { user, refs } = buildFollowupPrompt(target, events);

  let kept;
  if (target.kind === "commitment") {
    const res = await generateStructured({ schema: FollowupSchema, system: FOLLOWUP_SYSTEM, user, modelTier: "fast", task: FOLLOWUP_TASK }, llmDeps(deps));
    noteModel(step, res);
    step.candidates = res.data.followups.length + res.data.context.length;
    kept = postProcessFollowup(res.data, refs, target);
  } else {
    const res = await generateStructured({ schema: DutyContextSchema, system: DUTY_CONTEXT_SYSTEM, user, modelTier: "fast", task: DUTY_CONTEXT_TASK }, llmDeps(deps));
    noteModel(step, res);
    step.candidates = res.data.context.length;
    kept = postProcessFollowup(res.data, refs, target);
  }
  step.dropped = kept.dropped as Record<string, number>;

  const { data: rec, error: recError } = await db.rpc("record_followup", {
    p_workspace: workspaceId,
    p_obligation: target.obligationId,
    p_evidence: kept.evidence.map((e) => ({ event_id: e.event.id, quote: e.quote, relation: e.relation, inferred: e.inferred })),
    p_context: kept.context.map((c) => ({ event_id: c.event.id, quote: c.quote, kind: c.kind, note: c.note })),
  });
  if (recError) throw new Error(`Could not record the follow-up: ${recError.message}`);
  const r = rec?.[0];
  step.evidenceAdded = r?.evidence_added ?? 0;
  step.contextAdded = r?.context_added ?? 0;
  step.duplicates = r?.duplicates ?? 0;
  step.rejected = r?.rejected ?? 0;
  step.status = target.kind === "commitment" ? (r?.status ?? null) : null;
  if (step.rejected) step.dropped.rejected_by_database = step.rejected;
}

type MatchRow = {
  id: string; kind: "commitment" | "recurring"; description: string; owed_by: string | null; owed_to: string | null;
  due_text: string | null; cadence: string | null; approver: string | null; access_level: MatchItem["level"];
  evidence: { event_id: string; relation: string; quote: string; events: { ts: string | null; sources: { type: MatchItem["sources"][number]["sourceType"] } | null } | null }[];
};
const MATCH_COLUMNS = "id, kind, description, owed_by, owed_to, due_text, cadence, approver, access_level, evidence(event_id, relation, quote, events(ts, sources(type)))";

/** Items the caller may read, with the readable messages that state them. Items with none are left out. */
async function loadMatchItems(db: Db, workspaceId: string, ids?: string[]): Promise<MatchItem[]> {
  let q = db.from("obligations").select(MATCH_COLUMNS).eq("workspace_id", workspaceId).neq("review_state", "rejected");
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("created_at");
  if (error) throw new Error(`Could not read obligations: ${error.message}`);
  const items: MatchItem[] = [];
  for (const o of (data ?? []) as unknown as MatchRow[]) {
    const sources = o.evidence
      .filter((e) => e.relation === "supports" && e.events)
      .map((e) => ({ eventId: e.event_id, quote: e.quote, ts: e.events!.ts, sourceType: e.events!.sources?.type ?? "whatsapp" }))
      .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? "") || a.eventId.localeCompare(b.eventId));
    if (sources.length === 0) continue;
    items.push({
      id: o.id, kind: o.kind, description: o.description, owedBy: o.owed_by, owedTo: o.owed_to, dueText: o.due_text,
      cadence: o.cadence, approver: o.approver, level: o.access_level, sources,
    });
  }
  return items;
}

async function linkPair(db: Db, workspaceId: string, p: MatchPair, verdict: "same" | "possible", method: "rule" | "model", step: StepResult) {
  const { data, error } = await db.rpc("link_obligations", { p_workspace: workspaceId, p_a: p.a, p_b: p.b, p_verdict: verdict, p_method: method, p_score: p.score });
  if (error) {
    step.rejected++;
    return;
  }
  const r = data?.[0];
  if (r?.created && r.verdict === "same") step.linked = (step.linked ?? 0) + 1;
  else if (r?.created) step.possible = (step.possible ?? 0) + 1;
  else step.duplicates++;
}

/**
 * Score every pair of readable items: link near-identical ones by rule, and queue the uncertain
 * middle for the model in fixed batches (ids and scores only).
 */
async function planMatchesStep({ db, workspaceId, runId, userId, step }: StepContext) {
  const items = await loadMatchItems(db, workspaceId);
  const { data: aliases } = await db.from("aliases").select("canonical, variants").eq("workspace_id", workspaceId);
  // A pair a reviewer has ruled on ("same" or "not the same") is left alone.
  const { data: reviewed } = await db.from("obligation_links").select("a, b").eq("workspace_id", workspaceId).eq("method", "reviewer");
  const plan = planMatches(items, aliases ?? [], undefined, new Set((reviewed ?? []).map((l) => pairKey(l.a, l.b))));
  step.candidates = plan.rule.length + plan.ask.length;
  for (const p of plan.rule) await linkPair(db, workspaceId, p, "same", "rule", step);
  const batches = batchPairs(plan.ask);
  await insertJobs(db, batches.map((b, i) => job(workspaceId, runId, userId, MATCH_TASK, i + 1, batches.length, { pairs: b.map((p) => [p.a, p.b, p.score]) })));
  step.planned = batches.length;
  if (plan.overLimit) step.dropped = { match_over_limit: plan.overLimit };
  if (step.rejected) step.dropped.rejected_by_database = step.rejected;
}

/** Ask the model whether each pair in the batch is the same item; store its verdicts as links. */
async function matchStep({ db, workspaceId, payload, deps, step }: StepContext) {
  const pairs = (payload.pairs ?? []).map(([a, b, score]) => ({ a, b, score }));
  const items = await loadMatchItems(db, workspaceId, [...new Set(pairs.flatMap((p) => [p.a, p.b]))]);
  const byId = new Map(items.map((i) => [i.id, i]));
  // Pairs whose items were removed (or are no longer readable) since planning are skipped.
  const live = pairs.filter((p) => byId.has(p.a) && byId.has(p.b));
  if (live.length === 0) return;
  const { user, refs } = buildMatchPrompt(live, byId);
  const res = await generateStructured({ schema: MatchSchema, system: MATCH_SYSTEM, user, modelTier: "fast", task: MATCH_TASK }, llmDeps(deps));
  noteModel(step, res);
  step.candidates = live.length;
  const kept = postProcessMatches(res.data, refs);
  step.dropped = kept.dropped as Record<string, number>;
  for (const p of kept.same) await linkPair(db, workspaceId, p, "same", "model", step);
  for (const p of kept.possible) await linkPair(db, workspaceId, p, "possible", "model", step);
  if (step.rejected) step.dropped.rejected_by_database = step.rejected;
}

const STEPS: Record<JobKind, (c: StepContext) => Promise<void>> = {
  [EXTRACT_TASK]: extractStep,
  [DUTIES_TASK]: dutiesStep,
  [PLAN_FOLLOWUPS_TASK]: planFollowupsStep,
  [FOLLOWUP_TASK]: followupStep,
  [PLAN_MATCHES_TASK]: planMatchesStep,
  [MATCH_TASK]: matchStep,
};

/**
 * Claim and run the caller's next job in this run. Returns null when nothing can be claimed:
 * either the run is finished, or an earlier stage is still running elsewhere (check progress).
 */
export async function runNextStep(db: Db, workspaceId: string, runId: string, userId: string, deps: RunDeps): Promise<StepResult | null> {
  const { data: claimed, error: claimError } = await db.rpc("claim_next_run_job", { p_workspace: workspaceId, p_run: runId });
  if (claimError) throw new Error(`Could not claim the next step: ${claimError.message}`);
  const row = claimed?.[0];
  if (!row) return null;

  const kind = row.kind as JobKind;
  const payload = row.payload as Payload;
  const step: StepResult = {
    kind, chunk: payload.chunk, of: payload.of, candidates: 0, created: 0, duplicates: 0, rejected: 0,
    dropped: {}, cached: false, model: null, usage: { inputTokens: 0, outputTokens: 0 },
  };

  let status: "done" | "queued" | "failed" = "done";
  try {
    const run = STEPS[kind];
    if (!run) throw new Error(`unknown job kind ${kind}`);
    await run({ db, workspaceId, runId, userId, payload, deps, step });
  } catch (err) {
    if (err instanceof LlmError) {
      const retry = err.retryable && row.attempts < MAX_ATTEMPTS;
      status = retry ? "queued" : "failed";
      step.error = {
        code: err.code,
        message: err.message,
        retryable: retry,
        retryAfterMs: "retryAfterMs" in err ? (err as { retryAfterMs: number | null }).retryAfterMs : null,
      };
    } else {
      status = "failed";
      step.error = { code: "internal", message: "This step failed unexpectedly.", retryable: false };
      console.error(`pipeline step ${kind} failed`, err);
    }
  }

  await db
    .from("jobs")
    .update({ status, result: step as unknown as Json, finished_at: status === "queued" ? null : new Date().toISOString() })
    .eq("id", row.id);
  return step;
}
