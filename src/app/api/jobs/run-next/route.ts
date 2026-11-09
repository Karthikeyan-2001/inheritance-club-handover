import { z } from "zod";
import { SupabaseLlmCache } from "@/lib/llm/cache-supabase";
import { LlmError } from "@/lib/llm/errors";
import { pipelineProvider } from "@/lib/pipeline/provider";
import { getRunProgress, runNextJob } from "@/lib/pipeline/run-extraction";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// One pipeline step per request keeps each call well inside the serverless time limit.
export const maxDuration = 60;

const Body = z.object({ runId: z.uuid() });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Run the caller's next queued step of an extraction run, and report progress. */
export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "A run id is required." }, 400);

  const viewer = await getViewer();
  if (!viewer) return json({ error: "Please sign in first." }, 401);
  if (!viewer.membership) return json({ error: "You are not a member of a workspace." }, 403);
  const { role, workspaceId } = viewer.membership;
  if (role !== "outgoing_lead" && role !== "advisor") return json({ error: "Only the outgoing lead or the advisor can run extraction." }, 403);

  const db = await createSupabaseServerClient();
  let deps;
  try {
    deps = { provider: pipelineProvider(), cache: new SupabaseLlmCache() };
  } catch (err) {
    return json({ error: err instanceof LlmError ? err.message : "Extraction is not configured on this server." }, 503);
  }
  try {
    const step = await runNextJob(db, workspaceId, body.data.runId, deps);
    const progress = await getRunProgress(db, workspaceId, body.data.runId);
    return json({ done: step === null, step, progress });
  } catch (err) {
    console.error("run-next failed", err);
    return json({ error: "This step could not be run. Try again." }, 500);
  }
}
