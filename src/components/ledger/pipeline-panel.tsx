"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelRun, startRun } from "@/app/ledger/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
  ungrounded_deliverable: "descriptions naming people or numbers not in their message (the quote is shown instead)",
  unrelated_context: "a note about something else",
  source_not_readable: "items whose source message you cannot read",
  match_over_limit: "possible duplicates beyond this run's limit, not compared",
  unknown_pair: "a match verdict for a pair that was not asked about",
  no_verdict: "pairs the model gave no verdict on (left unlinked)",
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
  const m = progress?.stages.match_items;
  const matchPlanned = (progress?.stages.plan_matches.done ?? 0) > 0;
  const statuses = STATUS_WORDS.map(([k, label]) => [progress?.followup.statuses[k] ?? 0, label] as const).filter(([n]) => n > 0);

  return (
    <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 text-sm shadow-sm shadow-primary/5">
      <h2 id="pipeline-heading" className="text-lg font-semibold">
        Build the ledger
      </h2>
      <p className="text-muted-foreground">
        Reads every message your role may read and lists the promises and yearly duties in them. Code checks that each quote really appears in its message; anything that fails is left out
        and counted. Results are drafts for you to review.
      </p>
      <details className="text-muted-foreground">
        <summary className="w-fit cursor-pointer font-medium text-foreground">How it works</summary>
        <p className="mt-2">
          It works in small steps using {provider === "anthropic" ? "Anthropic's Claude API" : "a test model"} ({model}): it finds promises and recurring duties with their approvals, checks each
          item for later follow-up and useful context, and links items recorded twice. A fixed rule, not a model, sets each item’s trust, and an item with no follow-up is marked “No evidence kept”.
        </p>
      </details>
      {canRun ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={start} disabled={pending || state === "running"}>
            {state === "running" && <Spinner />}
            {state === "running" ? "Reading…" : state === "done" ? "Build again" : "Build the ledger"}
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
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">
              Step {Math.min(finished, progress.total)} of {progress.total}
              {state === "running" && !planned ? " so far" : ""}
              {state === "done" ? ", finished" : state === "stopped" ? ", stopped" : ""}
            </span>
            <div
              role="progressbar"
              aria-label="Ledger build progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={Math.min(finished, progress.total)}
              className="h-3 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className={`h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none ${state === "running" ? "progress-stripes" : ""}`}
                style={{ width: `${progress.total ? Math.max(4, Math.round((Math.min(finished, progress.total) / progress.total) * 100)) : 4}%` }}
              />
            </div>
            {state === "running" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3.5 text-primary" />
                {!planned ? "Reading messages for promises and yearly duties…" : !matchPlanned ? "Checking each item for follow-up…" : "Linking items recorded twice…"}
                <span className="text-xs">Keep this tab open until it finishes.</span>
              </p>
            )}
            {state === "done" && (
              <p className="flex flex-wrap items-center gap-2 font-medium text-success">
                Done. Next, check the items.
                <Button asChild size="sm">
                  <Link href="/review?tab=draft">Review the items</Link>
                </Button>
              </p>
            )}
          </div>
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
            <li>
              Matching:{" "}
              {!matchPlanned ? (
                "waits for the follow-up checks."
              ) : (
                <>
                  <strong>{plural(progress.matching.same, "item")} linked</strong> to another record of the same obligation
                  {progress.matching.possible ? `, ${plural(progress.matching.possible, "possible match", "possible matches")} to review` : ""}
                  {m && m.total > 0 ? ` (${m.done} of ${plural(m.total, "comparison")} by the model)` : ""}. Trust and the docket are then settled by the trust rule.
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
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-destructive">
          {lastError} Your progress so far is kept; press the button to carry on.
        </p>
      )}
    </section>
  );
}
