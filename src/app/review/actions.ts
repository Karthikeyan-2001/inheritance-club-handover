"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form-state";
import { changedFields, FIELD_LABELS, type Kind } from "@/lib/review/fields";
import { RULING_LABELS } from "@/lib/review/labels";
import { getViewer, type Viewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Member = Viewer & { membership: NonNullable<Viewer["membership"]> };

async function requireMember(): Promise<Member | string> {
  const viewer = await getViewer();
  if (!viewer) return "Please sign in first.";
  if (!viewer.membership) return "Your account is not a member of a workspace.";
  return viewer as Member;
}

/** Plain words for a database refusal. The database says why; we only tidy the sentence. */
function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  const known = ["42501", "23514", "22023", "P0002"];
  if (error.code && known.includes(error.code)) return error.message.charAt(0).toUpperCase() + error.message.slice(1) + (error.message.endsWith(".") ? "" : ".");
  if (error.code === "22007" || error.code === "22008") return "A date was not valid. Write it as YYYY-MM-DD.";
  return fallback;
}

const Reason = z.string().trim().min(3, "Give a short reason.");
const Id = z.uuid("Invalid request.");

const ReviewAction = z.object({ id: Id, action: z.enum(["accept", "reject", "reopen"]), reason: Reason });

const DONE: Record<"accept" | "reject" | "reopen", string> = {
  accept: "Accepted.",
  reject: "Rejected. It stays on record and leaves the next version.",
  reopen: "Moved back to draft.",
};

/** Accept, reject or reopen one item, with a reason. The database checks the role and writes the audit row. */
export async function reviewItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = ReviewAction.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_obligation", { p_id: input.data.id, p_action: input.data.action, p_reason: input.data.reason });
  if (error) return { error: dbMessage(error, "Could not save the review.") };
  refresh();
  return { ok: DONE[input.data.action] };
}

const EditInput = z.object({ id: Id, reason: Reason });
const EDIT_COLUMNS = Object.keys(FIELD_LABELS).join(", ");

/** Edit the fields a reviewer may change. Only fields that differ from what is stored are sent. */
export async function editItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = EditInput.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { data: current, error: readError } = await supabase.from("obligations").select(`kind, ${EDIT_COLUMNS}`).eq("id", input.data.id).maybeSingle();
  if (readError) return { error: "Could not read the item. Try again in a minute." };
  if (!current) return { error: "That item was not found." };
  const row = current as unknown as Record<string, string | null> & { kind: Kind };
  const submitted: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (key.startsWith("f_") && typeof value === "string") submitted[key.slice(2)] = value;
  const { changes, error: invalid } = changedFields(row.kind, row, submitted);
  if (invalid) return { error: invalid };
  if (Object.keys(changes).length === 0) return { error: "Nothing was changed." };
  const { error } = await supabase.rpc("review_obligation", { p_id: input.data.id, p_action: "edit", p_reason: input.data.reason, p_changes: changes });
  if (error) return { error: dbMessage(error, "Could not save the edit.") };
  refresh();
  return { ok: "Saved. The item now counts as edited." };
}

const LinkInput = z.object({ a: Id, b: Id, verdict: z.enum(["same", "distinct"]), reason: Reason });

/** A reviewer's verdict on a pair: the same item, or not the same. Remembered for later runs. */
export async function setLinkVerdict(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = LinkInput.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_link_verdict", {
    p_workspace: me.membership.workspaceId, p_a: input.data.a, p_b: input.data.b, p_verdict: input.data.verdict, p_reason: input.data.reason,
  });
  if (error) return { error: dbMessage(error, "Could not save the verdict.") };
  refresh();
  return { ok: input.data.verdict === "same" ? "Recorded as the same item." : "Recorded as not the same. Later runs will leave this pair alone." };
}

const RulingInput = z.object({ entry: Id, ruling: z.enum(Object.keys(RULING_LABELS) as [keyof typeof RULING_LABELS, ...(keyof typeof RULING_LABELS)[]], "Choose a ruling."), reason: Reason });

/** The advisor's ruling on a conflict. Recorded as a decision; it does not change the item's trust. */
export async function ruleConflict(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = RulingInput.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("rule_conflict", { p_entry: input.data.entry, p_ruling: input.data.ruling, p_reason: input.data.reason });
  if (error) return { error: dbMessage(error, "Could not save the ruling.") };
  refresh();
  return { ok: `Ruling recorded: ${RULING_LABELS[input.data.ruling]}.` };
}

const ReasonOnly = z.object({ reason: Reason });

/** The outgoing lead marks the accepted draft ready for the advisor. */
export async function markReady(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = ReasonOnly.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_ready", { p_workspace: me.membership.workspaceId, p_reason: input.data.reason });
  if (error) return { error: dbMessage(error, "Could not mark the draft ready.") };
  refresh();
  return { ok: "Marked ready. The advisor can now approve it." };
}

/** The advisor approves the marked draft as a new immutable version. */
export async function approveVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = ReasonOnly.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_version", { p_workspace: me.membership.workspaceId, p_reason: input.data.reason });
  if (error) return { error: dbMessage(error, "Could not approve the version.") };
  refresh();
  return { ok: "Approved. A new version now exists and can no longer be changed." };
}
