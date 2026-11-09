"use server";

import { z } from "zod";
import { PlanError, planRun } from "@/lib/pipeline/run-pipeline";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StartResult = { runId: string; total: number } | { error: string };

/** Plan a run over every message the caller may read: commitments, duties, then follow-ups. */
export async function startRun(): Promise<StartResult> {
  const viewer = await getViewer();
  if (!viewer?.membership) return { error: "Please sign in first." };
  const { role, workspaceId } = viewer.membership;
  if (role !== "outgoing_lead" && role !== "advisor") return { error: "Only the outgoing lead or the advisor can build the ledger." };
  try {
    return await planRun(await createSupabaseServerClient(), workspaceId, viewer.userId);
  } catch (err) {
    return { error: err instanceof PlanError ? err.message : "Could not start the run." };
  }
}

/** Stop a run: steps not yet started are marked as cancelled. */
export async function cancelRun(runId: string): Promise<{ ok: boolean }> {
  const id = z.uuid().safeParse(runId);
  const viewer = await getViewer();
  if (!id.success || !viewer?.membership) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("jobs")
    .update({ status: "failed", result: { cancelled: true }, finished_at: new Date().toISOString() })
    .eq("workspace_id", viewer.membership.workspaceId)
    .eq("payload->>run_id", id.data)
    .eq("payload->>requested_by", viewer.userId)
    .eq("status", "queued");
  return { ok: !error };
}
