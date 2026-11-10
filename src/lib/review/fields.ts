import { z } from "zod";

// The fields a reviewer may edit, per kind. Mirrors review_obligation() in migration 0013,
// which refuses any other field. Status and trust are never editable: they come from evidence.
export const COMMITMENT_FIELDS = ["description", "owed_by", "owed_to", "due_text", "due_date"] as const;
export const RECURRING_FIELDS = ["description", "owed_by", "cadence", "approval_required", "approver", "lead_time", "next_due", "start_by"] as const;

export type Kind = "commitment" | "recurring";

export const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  owed_by: "Owed by",
  owed_to: "Owed to",
  due_text: "Due (as written)",
  due_date: "Due date",
  cadence: "How often",
  approval_required: "Approval needed",
  approver: "Approver",
  lead_time: "Start how far ahead",
  next_due: "Next due",
  start_by: "Start by",
};

const DATE_FIELDS = new Set(["due_date", "next_due", "start_by"]);

export function editableFields(kind: Kind): readonly string[] {
  return kind === "commitment" ? COMMITMENT_FIELDS : RECURRING_FIELDS;
}

export function isDateField(field: string): boolean {
  return DATE_FIELDS.has(field);
}

export type FieldValues = Record<string, string | null | undefined>;

const normalise = (v: string | null | undefined) => (v ?? "").trim();

/** A real calendar date written as YYYY-MM-DD (or empty, to clear the field). */
export function validDate(v: string): boolean {
  if (v === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The fields of `input` that differ from `current`, trimmed. Only editable fields count; a blank
 * clears a field (sent as an empty string, which the database stores as nothing). Fields not in
 * `input` are left alone. Returns an error message for an invalid date or an empty description.
 */
export function changedFields(kind: Kind, current: FieldValues, input: FieldValues): { changes: Record<string, string>; error?: string } {
  const changes: Record<string, string> = {};
  for (const field of editableFields(kind)) {
    if (!(field in input) || input[field] === undefined || input[field] === null) continue;
    const next = normalise(input[field]);
    if (next === normalise(current[field])) continue;
    if (field === "description" && next === "") return { changes: {}, error: "The description cannot be empty." };
    if (isDateField(field) && !validDate(next)) return { changes: {}, error: `${FIELD_LABELS[field]} must be a date written as YYYY-MM-DD.` };
    changes[field] = next;
  }
  return { changes };
}

/** Form input for the review actions: an id, a reason of at least three characters. */
export const ReviewInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(3, "Give a short reason."),
});
