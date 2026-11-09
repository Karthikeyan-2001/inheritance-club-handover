"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelExtraction, startExtraction } from "@/app/ledger/actions";
import { Button } from "@/components/ui/button";
import type { RunProgress, StepResult } from "@/lib/pipeline/run-extraction";

const DROP_LABELS: Record<string, string> = {
  quote_not_found: "quote not found in the cited message",
  quote_too_short: "quote too short to check",
  unknown_message: "cited a message that does not exist",
  non_binding: "hedged, not a firm promise",
  no_counterparty: "no clear person or group owed",
  no_deliverable: "nothing concrete promised",
  duplicate: "repeated",
  rejected_by_database: "refused by the database check",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts an extraction run and drives it step by step from the browser. */
export function ExtractionPanel({ canRun, provider, model }: { canRun: boolean; provider: string; model: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "stopped">("idle");
  const cancelled = useRef(false);

  async function drive(id: string) {
    let failures = 0;
    while (!cancelled.current) {
      let res: Response;
      try {
        res = await fetch("/api/jobs/run-next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) });
      } catch {
        setLastError("Lost connection to the server.");
        setState("stopped");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { done?: boolean; step?: StepResult | null; progress?: RunProgress; error?: string };
      if (!res.ok) {
        setLastError(body.error ?? "Something went wrong.");
        setState("stopped");
        return;
      }
      if (body.progress) setProgress(body.progress);
      if (body.done) break;
      const err = body.step?.error;
      if (err) {
        setLastError(err.message);
        if (err.code === "config" || err.code === "budget" || ++failures >= 5) {
          setState("stopped");
          router.refresh();
          return;
        }
        if (err.code === "rate_limit") await sleep(err.retryAfterMs ?? 5000);
      }
    }
    setState(cancelled.current ? "stopped" : "done");
    router.refresh();
  }

  function start() {
    cancelled.current = false;
    setLastError(null);
    setProgress(null);
    startTransition(async () => {
      const r = await startExtraction();
      if ("error" in r) {
        setLastError(r.error);
        return;
      }
      setRunId(r.runId);
      setProgress({ total: r.total, done: 0, failed: 0, pending: r.total, created: 0, duplicates: 0, candidates: 0, dropped: {}, cachedSteps: 0, usage: { inputTokens: 0, outputTokens: 0 } });
      setState("running");
      await drive(r.runId);
    });
  }

  async function stop() {
    cancelled.current = true;
    if (runId) await cancelExtraction(runId);
  }

  const finished = progress ? progress.done + progress.failed : 0;
  const dropped = Object.entries(progress?.dropped ?? {}).filter(([, n]) => n > 0);

  return (
    <section aria-labelledby="extract-heading" className="flex flex-col gap-3 rounded-md border p-4 text-sm">
      <h2 id="extract-heading" className="font-medium">
        Find commitments
      </h2>
      <p className="text-muted-foreground">
        Reads every message your role may read, in small steps, and asks {provider === "anthropic" ? "Anthropic's Claude API" : "a test model"} ({model}) for
        promises made to people. Code then checks that each quote really appears in the message it cites; anything that fails is left out and
        counted. Results are drafts for review.
      </p>
      {canRun ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={start} disabled={pending || state === "running"}>
            {state === "running" ? "Reading…" : "Find commitments"}
          </Button>
          {state === "running" && (
            <Button size="sm" variant="outline" onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      ) : (
        <p>Only the outgoing lead or the faculty advisor can run this.</p>
      )}

      {progress && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite" data-testid="extraction-progress">
          <label className="flex flex-col gap-1">
            <span>
              Step {Math.min(finished, progress.total)} of {progress.total}
              {state === "done" ? ", finished" : state === "stopped" ? ", stopped" : ""}
            </span>
            <progress max={progress.total} value={finished} className="w-full" />
          </label>
          <p>
            Found <strong>{progress.created}</strong> new commitment{progress.created === 1 ? "" : "s"}
            {progress.duplicates ? `, ${progress.duplicates} already known` : ""} from {progress.candidates} candidate
            {progress.candidates === 1 ? "" : "s"}.
            {progress.cachedSteps ? ` ${progress.cachedSteps} step${progress.cachedSteps === 1 ? "" : "s"} reused saved answers.` : ""}
          </p>
          {dropped.length > 0 && <p>Left out: {dropped.map(([k, n]) => `${n} ${DROP_LABELS[k] ?? k}`).join("; ")}.</p>}
          {progress.failed > 0 && <p>{progress.failed} step(s) could not be completed.</p>}
          {progress.usage.inputTokens + progress.usage.outputTokens > 0 && (
            <p className="text-muted-foreground">
              Model usage this run: {progress.usage.inputTokens.toLocaleString("en-IN")} input and {progress.usage.outputTokens.toLocaleString("en-IN")} output tokens.
            </p>
          )}
        </div>
      )}
      {lastError && (
        <p role="alert" className="text-destructive">
          {lastError}
        </p>
      )}
    </section>
  );
}
