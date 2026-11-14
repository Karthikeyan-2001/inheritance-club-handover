import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/feedback/empty-state";
import { ACCESS_LABELS } from "@/lib/access";
import { capitalise } from "@/lib/ledger-view";
import { SECTION_TITLES, QUESTION_KINDS, answerSummary, type GapQuestion } from "@/lib/questions";
import { answerGap } from "@/app/check/actions";
import { QuestionForm, QuestionsShell } from "./question-form";

const STATE_BADGE = { open: "Waiting for an answer", left_open: "Left open", answered: "Answered" } as const;

function itemHref(q: GapQuestion): string {
  return q.question === "conflict" && q.entryId ? `/check?tab=conflicts#docket-${q.entryId}` : `/ledger?tab=${q.itemKind === "recurring" ? "recurring" : "commitments"}#item-${q.obligationId}`;
}

function QuestionCard({ q, canAnswer, today }: { q: GapQuestion; canAnswer: boolean; today: string }) {
  const form = (
    <QuestionForm action={answerGap} question={q.question} obligationId={q.obligationId} entryId={q.entryId} description={q.description} itemLevel={q.accessLevel} today={today} />
  );
  return (
    <li id={`question-${q.key.replace(":", "-")}`} className="scroll-mt-4 rounded-xl border bg-card p-4 text-sm" data-testid="gap-question" data-state={q.state} data-question={q.question}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{capitalise(q.description)}</p>
        <span className="flex flex-wrap gap-1">
          <Badge variant={q.state === "open" ? "default" : q.state === "left_open" ? "secondary" : "outline"}>{STATE_BADGE[q.state]}</Badge>
          <Badge variant={q.accessLevel === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[q.accessLevel]}</Badge>
        </span>
      </div>
      <p className="mt-1 text-base font-semibold text-primary">{q.ask}</p>
      {q.detail && <p className="mt-1 text-muted-foreground">{q.detail}</p>}

      {q.answers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2" aria-label="Answers given">
          {q.answers.map((a, i) => (
            <li key={i} className="rounded-lg bg-secondary/60 p-2" data-testid="given-answer">
              {a.text ? <blockquote className="border-l-2 pl-3">“{a.text}”</blockquote> : <p className="text-muted-foreground">An answer you cannot read.</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.access_level ? `Readable at ${ACCESS_LABELS[a.access_level]}. ` : ""}
                The incoming lead sees it once the next version is approved.{" "}
                {answerSummary(a)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canAnswer && q.state === "open" && <div className="mt-3 border-t pt-3">{form}</div>}
      {canAnswer && q.state === "left_open" && (
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer font-medium">Answer it now</summary>
          <div className="mt-2">{form}</div>
        </details>
      )}
      <p className="mt-2 text-xs">
        <Link href={itemHref(q)} className="underline">
          {q.question === "conflict" ? "See the conflicting records" : "Open the item and its quotes"}
        </Link>
      </p>
    </li>
  );
}

/**
 * Gap questions for the outgoing lead, one page. Each answer becomes a message in the lead's name
 * ("Stated by the outgoing lead") and is cited like any other record, so the usual quote check,
 * trust rule, audit and review apply. Others who read the working ledger see the questions and
 * answers, but only the outgoing lead answers.
 */
export function Questions({ questions, canAnswer, today }: { questions: GapQuestion[]; canAnswer: boolean; today: string }) {
  if (questions.length === 0) {
    return (
      <EmptyState
        title="No questions"
        body="Every promise you can read has follow-up in the records, every duty has an approver and a next date, and no conflict is waiting for a ruling."
      />
    );
  }
  const open = questions.filter((q) => q.state === "open").length;
  const left = questions.filter((q) => q.state === "left_open").length;
  const answered = questions.length - open - left;
  return (
    <QuestionsShell>
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border bg-card p-4 text-sm" data-testid="questions-summary">
          <p role="status">
            <strong>
              {open} {open === 1 ? "question" : "questions"} to answer
            </strong>
            {left > 0 ? `, ${left} left open` : ""}
            {answered > 0 ? `, ${answered} answered` : ""}.
          </p>
          <p className="mt-1 text-muted-foreground">
            {canAnswer
              ? "Answer what you know while you can still be asked. Each answer is saved as a message from you, labelled “Stated by the outgoing lead”, and becomes a quote on the item, so its trust follows the usual rule. “I don't know” is fine: it is handed over as unknown. The incoming lead sees your answers on the handover page only once they are in an approved version: accept the changed items again, mark ready, and have the advisor approve."
              : "Only the outgoing lead answers these. Their answers are saved as messages labelled “Stated by the outgoing lead” and appear as quotes on each item."}
          </p>
        </div>
        {QUESTION_KINDS.map((kind) => {
          const list = questions.filter((q) => q.question === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} aria-labelledby={`q-${kind}`} className="flex flex-col gap-3">
              <div>
                <h2 id={`q-${kind}`} className="text-lg font-semibold">
                  {SECTION_TITLES[kind].title} <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
                </h2>
                <p className="text-sm text-muted-foreground">{SECTION_TITLES[kind].why}</p>
              </div>
              <ul className="flex flex-col gap-3" aria-label={SECTION_TITLES[kind].title}>
                {list.map((q) => (
                  <QuestionCard key={q.key} q={q} canAnswer={canAnswer} today={today} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </QuestionsShell>
  );
}
