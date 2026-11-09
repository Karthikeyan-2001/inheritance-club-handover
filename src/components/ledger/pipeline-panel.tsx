"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelRun, startRun } from "@/app/ledger/actions";
import { Button } from "@/components/ui/button";
import { emptyProgress, type RunProgress, type StepResult } from "@/lib/pipeline/progress";

const DROP_LABELS: Record<string, string> = {
  quote_not_found: "quote not found in the cited message",
  quote_too_short: "quote too short to check",
  unknown_message: "cited a message that does not exist",
  non_binding: "hedged, not a firm promise",
  no_counterparty: "no clear person or group owed",
  no_deliverable: "nothing concrete promised",
  duplicate: "repeated",
  rejected_by_database: "refused by the database check",
  cites_promise: "pointed at the promise itself as its follow-up",
  before_promise: "dated before the promise",
  undated: "undated, so it cannot follow the promise",
  question: "a question, not a report",
  no_note: "no usable note",
  over_limit: "more than five context notes",
  no_rule: "no message stating the duty",
  no_recurrence: "nothing in the quotes shows it repeats",
  ungrounded_field: "a detail not found in the quotes (left blank)",
  known_at_lower_level: "already known from a less restricted record",
  mixed_visibility: "quotes from records with different access levels",
  ungrounded_note: "a note naming people or numbers not in its quoted message",
  source_not_readable: "items whose source message you cannot read",
};

const STATUS_WORDS: [string, string][] = [
  ["fulfilled", "done"],
  ["likely_fulfilled", "likely done (inferred)"],
  ["contradicted", "contradicted"],
  ["open", "still open"],
  ["no_evidence", "no evidence kept"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Body = { done?: boolean; waiting?: boolean; step?: StepResult | null; progress?: RunProgress; error?: string };

/** Starts a run and drives it step by step from the browser. */
export function PipelinePanel({ canRun, provider, model }: { canRun: boolean; provider: string; model: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "stopped">("idle");
  const cancelled = useRef(false);

  async function drive(id: string) {
    let failures = 0;
    let waits = 0;
    while (!cancelled.current) {
      let res: Response;
      try {
        res = await fetch("/api/jobs/run-next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) });
      } catch {
        setLastError("Lost connection to the server.");
        setState("stopped");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as Body;
      if (!res.ok) {
        setLastError(body.error ?? "Something went wrong.");
        setState("stopped");
        return;
      }
      if (body.progress) setProgress(body.progress);
      if (body.done) break;
      if (body.waiting) {
        // An earlier step is still running in another tab or request; it is reclaimed after two minutes.
        if (++waits > 90) {
          setLastError("A step is taking too long. Try again in a few minutes.");
          setState("stopped");
          return;
        }
        await sleep(2000);
        continue;
      }
      waits = 0;
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
      const r = await startRun();
      if ("error" in r) {
        setLastError(r.error);
        return;
      }
      setRunId(r.runId);
      setProgress({ ...emptyProgress(), total: r.total, pending: r.total });
      setState("running");
      await drive(r.runId);
    });
  }

  async function stop() {
    cancelled.current = true;
    if (runId) await cancelRun(runId);
  }

  const finished = progress ? progress.done + progress.failed : 0;
  const dropped = Object.entries(progress?.dropped ?? {}).filter(([, n]) => n > 0);
  const c = progress?.stages.extract_commitments;
  const d = progress?.stages.find_duties;
  const f = progress?.stages.check_followup;
  const planned = (progress?.stages.plan_followups.done ?? 0) > 0;
  const statuses = STATUS_WORDS.map(([k, label]) => [progress?.followup.statuses[k] ?? 0, label] as const).filter(([n]) => n > 0);

  return (
    <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3 rounded-md border p-4 text-sm">
      <h2 id="pipeline-heading" className="font-medium">
        Build the ledger
      </h2>
      <p className="text-muted-foreground">
        Reads every message your role may read, in small steps, using {provider === "anthropic" ? "Anthropic's Claude API" : "a test model"} ({model}). It finds
        promises made to people and recurring duties with their approvals, then checks each item for later follow-up and useful context. Code checks
        that every quote really appears in the message it cites. Anything that fails is left out and counted, and an item with no follow-up is marked
        “No evidence kept”. Results are drafts for review.
      </p>
      {canRun ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={start} disabled={pending || state === "running"}>
            {state === "running" ? "Reading…" : "Build the ledger"}
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
        <div className="flex flex-col gap-2" role="status" aria-live="polite" data-testid="pipeline-progress">
          <label className="flex flex-col gap-1">
            <span>
              Step {Math.min(finished, progress.total)} of {progress.total}
              {state === "running" && !planned ? " so far" : ""}
              {state === "done" ? ", finished" : state === "stopped" ? ", stopped" : ""}
            </span>
            <progress max={progress.total} value={finished} className="w-full" />
          </label>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {c && (
              <li>
                Commitments: found <strong>{plural(c.created, "new commitment")}</strong>
                {c.duplicates ? `, ${c.duplicates} already known` : ""} from {plural(c.candidates, "candidate")}.
              </li>
            )}
            {d && (
              <li>
                Recurring duties: {d.total === 0 ? "no messages mention rules, cycles or approvals." : <><strong>{plural(d.created, "new recurring duty", "new recurring duties")}</strong>{d.duplicates ? `, ${d.duplicates} merged with ones already known` : ""}.</>}
              </li>
            )}
            <li>
              Follow-up:{" "}
              {!planned ? (
                "waits for the first two steps."
              ) : (
                <>
                  checked {f?.done ?? 0} of {plural(f?.total ?? 0, "item")}
                  {statuses.length > 0 && <> ({statuses.map(([n, label]) => `${n} ${label}`).join(", ")})</>}
                  {progress.followup.evidence + progress.followup.context > 0 &&
                    `; ${plural(progress.followup.evidence, "follow-up quote")} and ${plural(progress.followup.context, "context note")} added`}
                  .
                </>
              )}
            </li>
          </ol>
          {progress.cachedSteps > 0 && <p>{plural(progress.cachedSteps, "step")} reused saved answers.</p>}
          {dropped.length > 0 && <p>Left out: {dropped.map(([k, n]) => `${n} ${DROP_LABELS[k] ?? k}`).join("; ")}.</p>}
          {progress.failed > 0 && <p>{plural(progress.failed, "step")} could not be completed.</p>}
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
