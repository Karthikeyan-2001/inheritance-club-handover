// Database side of extraction, run as the signed-in user (RLS applies to every read and
// write, so the model only ever sees rows that user may read). Each job is one chunk, so
// each serverless step stays short; the browser drives the run by calling run-next.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured } from "../llm/adapter.ts";
import { LlmError } from "../llm/errors.ts";
import type { LlmCache, LlmProvider, Usage } from "../llm/types.ts";
import type { Database, Json } from "../supabase/database.types.ts";
import { EXTRACTION_SYSTEM, ExtractionSchema, buildExtractionPrompt, chunkEvents, postProcess, type PipelineEvent } from "./extract.ts";
import { EXTRACT_TASK } from "./tasks.ts";

type Db = SupabaseClient<Database>;

export const MAX_CHUNKS_PER_RUN = 400;
const MAX_ATTEMPTS = 3;
const PAGE = 1000;

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

type EventRow = { id: string; author: string | null; ts: string | null; text: string; thread_id: string | null; sources: { type: PipelineEvent["sourceType"] } | null };

const toEvent = (r: EventRow): PipelineEvent => ({
  id: r.id,
  author: r.author,
  ts: r.ts,
  text: r.text,
  threadId: r.thread_id,
  sourceType: r.sources?.type ?? "whatsapp",
});

/** Every event the caller may read in the workspace, oldest first. */
export async function loadReadableEvents(db: Db, workspaceId: string): Promise<PipelineEvent[]> {
  const out: PipelineEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("events")
      .select("id, author, ts, text, thread_id, sources(type)")
      .eq("workspace_id", workspaceId)
      .order("ts", { ascending: true, nullsFirst: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read messages: ${error.message}`);
    out.push(...(data as EventRow[]).map(toEvent));
    if (!data || data.length < PAGE) return out;
  }
}

/** Queue one job per chunk. Payloads hold event ids only, never text. */
export async function planExtraction(db: Db, workspaceId: string, userId: string): Promise<{ runId: string; total: number }> {
  const events = await loadReadableEvents(db, workspaceId);
  if (events.length === 0) throw new PlanError("There are no imported messages you can read yet. Import files first.");
  const chunks = chunkEvents(events);
  if (chunks.length > MAX_CHUNKS_PER_RUN) {
    throw new PlanError(`That is too much to read in one run (${chunks.length} parts, limit ${MAX_CHUNKS_PER_RUN}).`);
  }
  const runId = crypto.randomUUID();
  const rows = chunks.map((c, i) => ({
    workspace_id: workspaceId,
    kind: EXTRACT_TASK,
    payload: { run_id: runId, requested_by: userId, chunk: i + 1, of: chunks.length, event_ids: c.events.map((e) => e.id) },
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("jobs").insert(rows.slice(i, i + 100));
    if (error) throw new PlanError(error.code === "42501" ? "Only the outgoing lead or the advisor can run extraction." : "Could not start extraction.");
  }
  return { runId, total: chunks.length };
}

export type StepResult = {
  chunk: number;
  of: number;
  candidates: number;
  created: number;
  duplicates: number;
  rejected: number;
  dropped: Record<string, number>;
  cached: boolean;
  model: string | null;
  usage: Usage;
  error?: { code: string; message: string; retryable: boolean; retryAfterMs?: number | null };
};

export type RunProgress = {
  total: number;
  done: number;
  failed: number;
  pending: number;
  created: number;
  duplicates: number;
  candidates: number;
  dropped: Record<string, number>;
  cachedSteps: number;
  usage: Usage;
};

export async function getRunProgress(db: Db, workspaceId: string, runId: string): Promise<RunProgress> {
  const { data } = await db.from("jobs").select("status, result").eq("workspace_id", workspaceId).eq("payload->>run_id", runId);
  const p: RunProgress = { total: 0, done: 0, failed: 0, pending: 0, created: 0, duplicates: 0, candidates: 0, dropped: {}, cachedSteps: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  for (const j of data ?? []) {
    p.total++;
    if (j.status === "done") p.done++;
    else if (j.status === "failed") p.failed++;
    else p.pending++;
    const r = (j.result ?? null) as Partial<StepResult> | null;
    if (j.status !== "done" || !r) continue;
    p.created += r.created ?? 0;
    p.duplicates += r.duplicates ?? 0;
    p.candidates += r.candidates ?? 0;
    if (r.cached) p.cachedSteps++;
    p.usage.inputTokens += r.usage?.inputTokens ?? 0;
    p.usage.outputTokens += r.usage?.outputTokens ?? 0;
    for (const [k, n] of Object.entries(r.dropped ?? {})) p.dropped[k] = (p.dropped[k] ?? 0) + n;
  }
  return p;
}

async function loadEvents(db: Db, ids: string[]): Promise<PipelineEvent[]> {
  const byId = new Map<string, PipelineEvent>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("events").select("id, author, ts, text, thread_id, sources(type)").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(`Could not read messages: ${error.message}`);
    for (const r of data as EventRow[]) byId.set(r.id, toEvent(r));
  }
  // Keep the planned order; events removed (or no longer readable) since planning are skipped.
  return ids.map((id) => byId.get(id)).filter((e): e is PipelineEvent => Boolean(e));
}

export type RunDeps = { provider: LlmProvider; cache: LlmCache; env?: Record<string, string | undefined> };

/** Claim and process the caller's next job in this run. Returns null when nothing is left. */
export async function runNextJob(db: Db, workspaceId: string, runId: string, deps: RunDeps): Promise<StepResult | null> {
  const { data: claimed, error: claimError } = await db.rpc("claim_next_job", { p_workspace: workspaceId, p_kind: EXTRACT_TASK, p_run: runId });
  if (claimError) throw new Error(`Could not claim the next step: ${claimError.message}`);
  const job = claimed?.[0];
  if (!job) return null;

  const payload = job.payload as { chunk: number; of: number; event_ids: string[] };
  const step: StepResult = {
    chunk: payload.chunk, of: payload.of, candidates: 0, created: 0, duplicates: 0, rejected: 0,
    dropped: {}, cached: false, model: null, usage: { inputTokens: 0, outputTokens: 0 },
  };

  let status: "done" | "queued" | "failed" = "done";
  try {
    const events = await loadEvents(db, payload.event_ids);
    if (events.length > 0) {
      const { user, refs } = buildExtractionPrompt({ events });
      const res = await generateStructured(
        { schema: ExtractionSchema, system: EXTRACTION_SYSTEM, user, modelTier: "fast", task: EXTRACT_TASK },
        { provider: deps.provider, cache: deps.cache, env: deps.env },
      );
      step.cached = res.cached;
      step.model = res.model;
      step.usage = res.cached ? { inputTokens: 0, outputTokens: 0 } : res.usage;
      step.candidates = res.data.commitments.length;
      const { kept, dropped } = postProcess(res.data, refs);
      step.dropped = dropped as Record<string, number>;

      for (const c of kept) {
        const { data, error } = await db.rpc("add_extracted_commitment", {
          p_workspace: workspaceId,
          p_event: c.event.id,
          p_quote: c.quote,
          p_owed_by: c.owedBy,
          p_owed_to: c.owedTo,
          p_deliverable: c.deliverable,
          p_due_text: c.dueText ?? "",
        });
        if (error) step.rejected++;
        else if (data?.[0]?.created) step.created++;
        else step.duplicates++;
      }
      if (step.rejected) step.dropped.rejected_by_database = step.rejected;
    }
  } catch (err) {
    if (err instanceof LlmError) {
      const retry = err.retryable && job.attempts < MAX_ATTEMPTS;
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
      console.error("extraction step failed", err);
    }
  }

  await db
    .from("jobs")
    .update({ status, result: step as unknown as Json, finished_at: status === "queued" ? null : new Date().toISOString() })
    .eq("id", job.id);
  return step;
}
