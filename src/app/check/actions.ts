"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { STATUS_LABELS, TRUST_LABELS } from "@/components/ledger/commitments";
import { ACCESS_LEVELS } from "@/lib/access";
import type { FormState } from "@/lib/form-state";
import { startByFor } from "@/lib/pipeline/cycles";
import { ANSWERS_FOR, ANSWER_KINDS, QUESTION_KINDS } from "@/lib/questions";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/time";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date as a day, month and year.").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "That is not a real date.");
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Input = z
  .object({
    obligation: z.uuid("Invalid request."),
    question: z.enum(QUESTION_KINDS),
    answer: z.enum(ANSWER_KINDS, "Choose an answer first."),
    level: z.enum(ACCESS_LEVELS, "Choose who may read your answer."),
    entry: z.preprocess(blankToUndefined, z.uuid("Invalid request.").optional()),
    detail: z.preprocess(blankToUndefined, z.string().trim().max(500, "Keep your own words under 500 characters.").optional()),
    approver: z.preprocess(blankToUndefined, z.string().trim().max(120, "Keep the name under 120 characters.").optional()),
    nextDue: z.preprocess(blankToUndefined, Day.optional()),
  })
  .refine((v) => ANSWERS_FOR[v.question].includes(v.answer), "That answer does not fit the question.")
  .refine((v) => v.answer !== "approver" || Boolean(v.approver), "Name who gives the approval.")
  .refine((v) => v.answer !== "date" || Boolean(v.nextDue), "Give the next due date.");

const statusLabel = (s: string) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
const trustLabel = (t: string) => TRUST_LABELS[t as keyof typeof TRUST_LABELS] ?? t;

/**
 * The outgoing lead answers one gap question. The database writes the answer as a message from
 * them and cites it like any other record (public.answer_gap, migration 0022); this action only
 * checks the form and, for a date, works out the start day from the duty's stated lead time.
 */
export async function answerGap(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer?.membership) return { error: "Please sign in first." };
  if (viewer.membership.role !== "outgoing_lead") return { error: "Only the outgoing lead answers gap questions." };
  const input = Input.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const v = input.data;
  if (v.answer === "date" && v.nextDue! < istToday()) return { error: "The next due date cannot be in the past." };

  const supabase = await createSupabaseServerClient();
  const before = await supabase.from("obligations").select("lead_time").eq("id", v.obligation).maybeSingle();
  if (before.error) return { error: "Could not save your answer. Try again in a minute." };
  if (!before.data) return { error: "This item is no longer there, or you cannot read it." };
  const startBy = v.answer === "date" ? startByFor(v.nextDue!, before.data.lead_time) : null;

  const { error } = await supabase.rpc("answer_gap", {
    p_obligation: v.obligation,
    p_question: v.question,
    p_answer: v.answer,
    p_level: v.level,
    ...(v.detail ? { p_detail: v.detail } : {}),
    ...(v.answer === "approver" ? { p_approver: v.approver } : {}),
    ...(v.answer === "date" ? { p_next_due: v.nextDue } : {}),
    ...(startBy ? { p_start_by: startBy } : {}),
    ...(v.entry ? { p_entry: v.entry } : {}),
  });
  if (error) {
    if (error.code === "42501") return { error: "Only the outgoing lead answers gap questions." };
    if (error.code === "P0002") return { error: "This item is no longer there, or you cannot read it." };
    if (error.code === "23505") return { error: "This question is already answered. Reload the page to see the answer." };
    if (error.code === "23514" || error.code === "22023") return { error: `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.` };
    return { error: "Could not save your answer. Nothing was changed." };
  }
  refresh();

  // Say what the answer did: the trust and status rules have already run.
  const after = await supabase.from("obligations").select("kind, status, trust_state, review_state, reviewed_status, reviewed_trust").eq("id", v.obligation).maybeSingle();
  if (after.error || !after.data) return { ok: "Saved as a message from you." };
  const o = after.data;
  const facts = o.kind === "commitment" ? `It is now ${statusLabel(o.status)}, trust ${trustLabel(o.trust_state)}.` : `Its trust is now ${trustLabel(o.trust_state)}.`;
  const rereview = (o.review_state === "accepted" || o.review_state === "edited") && (o.status !== o.reviewed_status || o.trust_state !== o.reviewed_trust);
  return { ok: `Saved as a message from you. ${facts}${rereview ? " It was accepted before, so accept it again in Review." : ""}` };
}
