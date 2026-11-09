// Job kinds and model task names. A run has stages, claimed in order (claim_next_run_job):
//   1 extract_commitments  one job per chunk of messages
//   2 find_duties          one job per batch of candidate messages
//   3 plan_followups       one job that queues stage 4 once commitments and duties exist
//   4 check_followup       one job per obligation (fulfilment for commitments, context for both)
//   5 plan_matches         one job: links near-identical items by rule, queues stage 6
//   6 match_items          one job per batch of uncertain pairs (the model's verdicts)
export const EXTRACT_TASK = "extract_commitments";
export const DUTIES_TASK = "find_duties";
export const PLAN_FOLLOWUPS_TASK = "plan_followups";
export const FOLLOWUP_TASK = "check_followup";
export const PLAN_MATCHES_TASK = "plan_matches";
export const MATCH_TASK = "match_items";
/** Model task for the context of a recurring duty (same job kind as FOLLOWUP_TASK). */
export const DUTY_CONTEXT_TASK = "duty_context";

export const STAGES = {
  [EXTRACT_TASK]: 1, [DUTIES_TASK]: 2, [PLAN_FOLLOWUPS_TASK]: 3, [FOLLOWUP_TASK]: 4, [PLAN_MATCHES_TASK]: 5, [MATCH_TASK]: 6,
} as const;
export type JobKind = keyof typeof STAGES;
