// What stands between the draft and a version, in words. The database re-checks every rule
// (mark_ready() and approve_version()); this only explains them before the button is pressed.

export type Role = "outgoing_lead" | "advisor" | "incoming_lead" | "treasurer" | "member";

export type ReadinessInput = {
  role: Role;
  /** Accepted or edited items the viewer can read. */
  acceptedCount: number;
  /** Of those, how many changed since they were accepted. */
  needsRereviewCount: number;
  /** The outgoing lead's latest mark, and whether it still matches the pending items. */
  signoff: { isCurrent: boolean } | null;
};

export type Gate = { ok: boolean; reasons: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function readiness(input: ReadinessInput): { markReady: Gate; approve: Gate } {
  const common: string[] = [];
  if (input.acceptedCount === 0) common.push("No item is accepted yet.");
  if (input.needsRereviewCount > 0) {
    common.push(`${plural(input.needsRereviewCount, "accepted item has", "accepted items have")} changed since ${input.needsRereviewCount === 1 ? "it was" : "they were"} accepted. Accept or reject ${input.needsRereviewCount === 1 ? "it" : "them"} again.`);
  }

  const markReady: string[] = [...common];
  if (input.role !== "outgoing_lead") markReady.unshift("Only the outgoing lead marks the draft ready for the advisor.");

  const approve: string[] = [...common];
  if (input.role !== "advisor") approve.unshift("Only the faculty advisor approves a version.");
  if (!input.signoff) approve.push("The outgoing lead has not marked the draft ready for the advisor.");
  else if (!input.signoff.isCurrent) approve.push("The draft changed after the outgoing lead marked it ready. It must be marked ready again.");

  return { markReady: { ok: markReady.length === 0, reasons: markReady }, approve: { ok: approve.length === 0, reasons: approve } };
}
