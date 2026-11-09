// The commitment status rule (CLAUDE.md, non-negotiables 2 and 9). The database applies it
// in app.followup_status() (migration 0010); this mirror is for the eval and unit tests.
// Keep the two in sync.

export type FollowupStatus = "fulfilled" | "likely_fulfilled" | "no_evidence" | "contradicted" | "open";

export type StatusEvidence = { relation: "supports" | "fulfils" | "contradicts" | "past_instance"; inferred: boolean; verified: boolean };

/**
 * Only verified evidence counts. Says done and says not done: contradicted. Says done:
 * fulfilled. Only implies done: likely fulfilled. Only says not done: still open.
 * Nothing at all: no evidence kept (never "pending", never "done").
 */
export function followupStatus(evidence: readonly StatusEvidence[]): FollowupStatus {
  const v = evidence.filter((e) => e.verified);
  const done = v.some((e) => e.relation === "fulfils");
  const direct = v.some((e) => e.relation === "fulfils" && !e.inferred);
  const notDone = v.some((e) => e.relation === "contradicts");
  if (done && notDone) return "contradicted";
  if (direct) return "fulfilled";
  if (done) return "likely_fulfilled";
  if (notDone) return "open";
  return "no_evidence";
}
