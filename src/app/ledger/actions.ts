"use server";

import { z } from "zod";
import { PlanError, planExtraction } from "@/lib/pipeline/run-extraction";
import { EXTRACT_TASK } from "@/lib/pipeline/tasks";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StartResult = { runId: string; total: number } | { error: string };

/** Plan an extraction run over every message the caller may read. */
export async function startExtraction(): Promise<StartResult> {
  const viewer = await getViewer();
  if (!viewer?.membership) return { error: "Please sign in first." };
  const { role, workspaceId } = viewer.membership;
  if (role !== "outgoing_lead" && role !== "advisor") return { error: "Only the outgoing lead or the advisor can run extraction." };
  try {
    return await planExtraction(await createSupabaseServerClient(), workspaceId, viewer.userId);
  } catch (err) {
    return { error: err instanceof PlanError ? err.message : "Could not start extraction." };
  }
}

/** Stop a run: steps not yet started are marked as cancelled. */
export async function cancelExtraction(runId: string): Promise<{ ok: boolean }> {
  const id = z.uuid().safeParse(runId);
  const viewer = await getViewer();
  if (!id.success || !viewer?.membership) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("jobs")
    .update({ status: "failed", result: { cancelled: true }, finished_at: new Date().toISOString() })
    .eq("workspace_id", viewer.membership.workspaceId)
    .eq("kind", EXTRACT_TASK)
    .eq("payload->>run_id", id.data)
    .eq("status", "queued");
  return { ok: !error };
}
