export const RULING_LABELS = { done: "Done", not_done: "Not done", cannot_tell: "Cannot tell" } as const;
export type Ruling = keyof typeof RULING_LABELS;

/** A ruling records the advisor's decision. It is not evidence, so the item stays contradicted. */
export const RULING_NOTE = "The advisor's decision, not evidence: the records still disagree, so the item stays contradicted.";

export function rulingLabel(ruling: string | null | undefined): string {
  return ruling && ruling in RULING_LABELS ? RULING_LABELS[ruling as Ruling] : "No ruling yet";
}
