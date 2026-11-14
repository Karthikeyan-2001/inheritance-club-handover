"use client";

import { useActionState, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { NoticeToast } from "@/components/feedback/notice-toast";
import { NoticeContext } from "@/components/review/notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import type { FormState } from "@/lib/form-state";
import { ANSWERS_FOR, ANSWER_LABELS, levelChoices, rolesLosingSight, statementText, type AnswerKind, type QuestionKind } from "@/lib/questions";

const SLOW_AFTER_MS = 12_000;

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Holds the "saved" line, which must outlive the form: an answered question moves to another list. */
export function QuestionsShell({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <NoticeContext.Provider value={setNotice}>
      {children}
      <NoticeToast notice={notice} onDismiss={() => setNotice(null)} testId="question-notice" />
    </NoticeContext.Provider>
  );
}

/**
 * One gap question's answer. Shows the exact message that will be saved in the lead's name
 * (the same words the database writes) and, when a more restricted level would hide the item
 * from someone, says who.
 */
export function QuestionForm({
  action,
  question,
  obligationId,
  entryId,
  description,
  itemLevel,
  today,
}: {
  action: Action;
  question: QuestionKind;
  obligationId: string;
  entryId: string | null;
  description: string;
  itemLevel: AccessLevel;
  today: string;
}) {
  const notify = useContext(NoticeContext);
  const id = useId();
  const [answer, setAnswer] = useState<AnswerKind | null>(null);
  const [level, setLevel] = useState<AccessLevel>(itemLevel);
  const [approver, setApprover] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [detail, setDetail] = useState("");
  const [slow, setSlow] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result?.ok) notify?.(`“${description}”: ${result.ok}`);
    return result;
  }, null);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);

  const ready = answer !== null && (answer !== "approver" || approver.trim() !== "") && (answer !== "date" || nextDue !== "");
  const preview = answer ? statementText({ question, answer, description, approver, nextDue: nextDue || null, detail }) : null;
  const losing = answer ? rolesLosingSight(itemLevel, level, answer) : [];
  const levels = levelChoices(itemLevel);

  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" aria-busy={pending} data-testid="question-form">
      <input type="hidden" name="obligation" value={obligationId} />
      <input type="hidden" name="question" value={question} />
      {entryId && <input type="hidden" name="entry" value={entryId} />}

      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="mb-1 text-muted-foreground">Your answer</legend>
        {ANSWERS_FOR[question].map((a) => (
          <label key={a} className="flex items-center gap-1.5">
            <input type="radio" name="answer" value={a} required checked={answer === a} onChange={() => setAnswer(a)} />
            {ANSWER_LABELS[question][a]}
          </label>
        ))}
      </fieldset>

      {/* The rest appears once an answer is chosen, so a page of questions stays short. */}
      {answer !== null && (
        <>
        {answer === "approver" && (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Whose approval?</span>
            <input name="approver" required maxLength={120} value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="For example: the HoD, ECE" className="rounded-lg border border-input bg-card px-3 py-2" />
          </label>
        )}
        {answer === "date" && (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Next due on</span>
            <input name="nextDue" type="date" required min={today} value={nextDue} onChange={(e) => setNextDue(e.target.value)} className="w-fit rounded-lg border border-input bg-card px-3 py-2" />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">In your own words (optional)</span>
          <textarea name="detail" maxLength={500} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Anything the next lead should know: when, who, where it is kept." className="rounded-lg border border-input bg-card px-3 py-2" />
        </label>

        <label className="flex flex-col gap-1" htmlFor={`${id}-level`}>
          <span className="text-muted-foreground">Who may read your answer</span>
          <select id={`${id}-level`} name="level" value={level} onChange={(e) => setLevel(e.target.value as AccessLevel)} className="w-fit rounded-lg border border-input bg-card px-3 py-2">
            {levels.map((l) => (
              <option key={l} value={l}>
                {ACCESS_LABELS[l]}
                {l === itemLevel ? " (same as the item)" : ""}
              </option>
            ))}
          </select>
          {levels.length > 1 && <span className="text-xs text-muted-foreground">Never less restricted than the item, because your answer names it.</span>}
        </label>
        {losing.length > 0 && (
          <p className="rounded-lg bg-warning-soft px-3 py-2" data-testid="level-warning">
            Your answer becomes evidence, so the item moves to {ACCESS_LABELS[level]}: {losing.map((r) => (r === "Member" ? "members" : `the ${r.toLowerCase()}`)).join(" and ")} will no longer see it.
          </p>
        )}

        {preview && (
          <div className="rounded-lg border border-dashed p-2" data-testid="answer-preview">
            <p className="text-xs text-muted-foreground">Saved as a message from you, readable at {ACCESS_LABELS[level]}:</p>
            <blockquote className="mt-1 border-l-2 pl-3">“{preview}”</blockquote>
          </div>
        )}
        </>
      )}

      <div>
        <Button type="submit" size="sm" disabled={pending || !ready}>
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save the answer"}
        </Button>
        {!ready && !pending && <span className="ml-2 text-xs text-muted-foreground">{answer === null ? "Choose an answer first." : answer === "approver" ? "Name whose approval it needs." : "Give the date."}</span>}
      </div>
      {pending && slow && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2">
          This is taking longer than usual. Your answer may already be saved.
          <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload to check
          </Button>
        </p>
      )}
      {state?.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-success">
          {state.ok}
        </p>
      )}
    </form>
  );
}
