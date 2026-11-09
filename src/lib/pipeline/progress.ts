// Shapes of a run's step results and progress. Pure, so the browser can import it.

import type { Usage } from "../llm/types.ts";
import { DUTIES_TASK, EXTRACT_TASK, FOLLOWUP_TASK, PLAN_FOLLOWUPS_TASK, type JobKind } from "./tasks.ts";

export type StepResult = {
  kind: JobKind;
  chunk: number;
  of: number;
  /** Items the model proposed. */
  candidates: number;
  /** New commitments or duties stored. */
  created: number;
  /** Already known (merged or repeated). */
  duplicates: number;
  /** Refused by the database check. */
  rejected: number;
  dropped: Record<string, number>;
  /** plan_followups: follow-up checks queued. */
  planned?: number;
  /** check_followup: evidence and context stored, and the resulting status (commitments). */
  evidenceAdded?: number;
  contextAdded?: number;
  status?: string | null;
  cached: boolean;
  model: string | null;
  usage: Usage;
  error?: { code: string; message: string; retryable: boolean; retryAfterMs?: number | null };
};

export type StageProgress = { total: number; done: number; failed: number; pending: number; candidates: number; created: number; duplicates: number };

export type RunProgress = {
  total: number;
  done: number;
  failed: number;
  pending: number;
  stages: Record<JobKind, StageProgress>;
  dropped: Record<string, number>;
  followup: { evidence: number; context: number; statuses: Record<string, number> };
  cachedSteps: number;
  usage: Usage;
};

const emptyStage = (): StageProgress => ({ total: 0, done: 0, failed: 0, pending: 0, candidates: 0, created: 0, duplicates: 0 });

export function emptyProgress(): RunProgress {
  return {
    total: 0, done: 0, failed: 0, pending: 0,
    stages: { [EXTRACT_TASK]: emptyStage(), [DUTIES_TASK]: emptyStage(), [PLAN_FOLLOWUPS_TASK]: emptyStage(), [FOLLOWUP_TASK]: emptyStage() },
    dropped: {}, followup: { evidence: 0, context: 0, statuses: {} }, cachedSteps: 0, usage: { inputTokens: 0, outputTokens: 0 },
  };
}
