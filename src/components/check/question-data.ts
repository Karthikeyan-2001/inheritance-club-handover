import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { gapQuestions, type GapQuestion, type QuestionAnswer, type QuestionConflict, type QuestionItem } from "@/lib/questions";

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type AnswerRow = Omit<QuestionAnswer, "text" | "access_level"> & { events: { text: string; access_level: QuestionAnswer["access_level"] } | null };

/**
 * The gap questions for the items the viewer can read. Items, conflicts and answers are read
 * through the viewer's session, so RLS filters before anything is worked out.
 */
export async function loadQuestions(supabase: Db, workspaceId: string): Promise<{ questions: GapQuestion[]; error: boolean }> {
  const [items, docket, answers] = await Promise.all([
    supabase
      .from("obligations")
      .select("id, kind, description, status, access_level, review_state, approval_required, approver, next_due, lead_time")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase.from("docket_entries").select("id, obligation_id, ruling, summary").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    supabase.from("gap_answers").select("obligation_id, docket_entry_id, question, answer, created_at, events(text, access_level)").eq("workspace_id", workspaceId),
  ]);
  if (items.error || docket.error || answers.error) return { questions: [], error: true };
  const given = ((answers.data ?? []) as unknown as AnswerRow[]).map(({ events, ...a }) => ({ ...a, text: events?.text ?? null, access_level: events?.access_level ?? null }));
  return {
    questions: gapQuestions((items.data ?? []) as unknown as QuestionItem[], (docket.data ?? []) as QuestionConflict[], given),
    error: false,
  };
}
