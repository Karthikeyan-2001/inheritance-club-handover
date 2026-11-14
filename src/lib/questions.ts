// Gap questions for the outgoing lead (Round 3, improvement 2).
// Pure. The page reads items, conflicts and earlier answers through the viewer's own session,
// so RLS has already filtered them; nothing here can reveal an item the viewer cannot read.
// The answer is stored by public.answer_gap() (migration 0022), which writes the message;
// statementText() mirrors its wording so the form can show the message before it is saved.

import { ACCESS_LEVELS, ROLE_LABELS, canRead, levelRank, type AccessLevel, type AppRole } from "./access.ts";

export const QUESTION_KINDS = ["followup", "conflict", "approver", "date"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const ANSWER_KINDS = ["done", "not_done", "approver", "no_approval", "date", "unknown"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Which answers fit which question (the same pairs answer_gap() accepts). */
export const ANSWERS_FOR: Record<QuestionKind, readonly AnswerKind[]> = {
  followup: ["done", "not_done", "unknown"],
  conflict: ["done", "not_done", "unknown"],
  approver: ["approver", "no_approval", "unknown"],
  date: ["date", "unknown"],
};

export const ANSWER_LABELS: Record<QuestionKind, Partial<Record<AnswerKind, string>>> = {
  followup: { done: "It was done", not_done: "It was not done", unknown: "I don't know" },
  conflict: { done: "It was done", not_done: "It was not done", unknown: "I don't know" },
  approver: { approver: "Someone approves it", no_approval: "No approval is needed", unknown: "I don't know" },
  date: { date: "I know the date", unknown: "I don't know" },
};

export const SECTION_TITLES: Record<QuestionKind, { title: string; why: string }> = {
  followup: { title: "Promises with no follow-up", why: "The records show the promise, but nothing after it says whether it was kept." },
  conflict: { title: "Conflicts nobody has ruled on", why: "One record says it was done and another says it was not. The advisor rules; your answer is one more record for them to weigh." },
  approver: { title: "Duties with no approver", why: "The records state the duty, but not whose approval it needs." },
  date: { title: "Duties with no next date", why: "No date for the next time can be worked out from the records." },
};

export type QuestionItem = {
  id: string;
  kind: "commitment" | "recurring";
  description: string;
  status: string;
  access_level: AccessLevel;
  review_state: string;
  approval_required: string | null;
  approver: string | null;
  next_due: string | null;
  lead_time: string | null;
};
export type QuestionConflict = { id: string; obligation_id: string | null; ruling: string | null; summary: string };
export type QuestionAnswer = {
  obligation_id: string;
  docket_entry_id: string | null;
  question: QuestionKind;
  answer: AnswerKind;
  created_at: string;
  /** The message the answer became, when the viewer can read it. */
  text: string | null;
  access_level: AccessLevel | null;
};

export type QuestionState = "open" | "left_open" | "answered";
export type GapQuestion = {
  key: string;
  question: QuestionKind;
  obligationId: string;
  entryId: string | null;
  description: string;
  itemKind: QuestionItem["kind"];
  accessLevel: AccessLevel;
  ask: string;
  /** For a conflict: which records disagree (code-written, no message text). */
  detail: string | null;
  leadTime: string | null;
  state: QuestionState;
  /** Answers given, oldest first. */
  answers: QuestionAnswer[];
};

function ask(q: QuestionKind, item: QuestionItem): string {
  if (q === "followup") return "Was this done?";
  if (q === "conflict") return "The records disagree. Was it done?";
  if (q === "approver") return item.approval_required ? `Who gives the ${item.approval_required.replace(/^the\s+/i, "")}?` : "Does this need anyone's approval?";
  return "When is it next due?";
}

/** Does the gap behind this question still hold? The same tests answer_gap() makes. */
function holds(q: QuestionKind, item: QuestionItem, conflict?: QuestionConflict): boolean {
  if (q === "followup") return item.kind === "commitment" && item.status === "no_evidence";
  if (q === "conflict") return Boolean(conflict) && conflict!.ruling === null;
  if (q === "approver") return item.kind === "recurring" && item.approver === null;
  return item.kind === "recurring" && item.next_due === null;
}

/**
 * Every question for the items the viewer can read: the gaps that still hold, and the ones
 * already answered (so the lead sees what they said). Rejected items ask nothing. An answer of
 * "I don't know" leaves the question open on purpose ("left open"), and it can be answered later.
 * Open questions come first, then those left open, then answered ones; each group keeps the
 * order of `QUESTION_KINDS` and then the items' order.
 */
export function gapQuestions(items: readonly QuestionItem[], conflicts: readonly QuestionConflict[], answers: readonly QuestionAnswer[]): GapQuestion[] {
  const out: GapQuestion[] = [];
  const byQuestion = new Map<string, QuestionAnswer[]>();
  const keyOf = (q: QuestionKind, obligation: string, entry: string | null) => (q === "conflict" ? `conflict:${entry}` : `${q}:${obligation}`);
  for (const a of [...answers].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const k = keyOf(a.question, a.obligation_id, a.docket_entry_id);
    byQuestion.set(k, [...(byQuestion.get(k) ?? []), a]);
  }
  const push = (q: QuestionKind, item: QuestionItem, conflict?: QuestionConflict) => {
    const key = keyOf(q, item.id, conflict?.id ?? null);
    const given = byQuestion.get(key) ?? [];
    const settled = given.some((a) => a.answer !== "unknown");
    if (!holds(q, item, conflict) && given.length === 0) return;
    const state: QuestionState = settled || !holds(q, item, conflict) ? "answered" : given.length ? "left_open" : "open";
    out.push({
      key,
      question: q,
      obligationId: item.id,
      entryId: conflict?.id ?? null,
      description: item.description,
      itemKind: item.kind,
      accessLevel: item.access_level,
      ask: ask(q, item),
      detail: conflict?.summary ?? null,
      leadTime: item.lead_time,
      state,
      answers: given,
    });
  };
  for (const item of items) {
    if (item.review_state === "rejected") continue;
    if (item.kind === "commitment") push("followup", item);
    for (const c of conflicts) if (c.obligation_id === item.id) push("conflict", item, c);
    if (item.kind === "recurring") {
      push("approver", item);
      push("date", item);
    }
  }
  const rank: Record<QuestionState, number> = { open: 0, left_open: 1, answered: 2 };
  return out
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank[a.q.state] - rank[b.q.state] || QUESTION_KINDS.indexOf(a.q.question) - QUESTION_KINDS.indexOf(b.q.question) || a.i - b.i)
    .map((x) => x.q);
}

export const openCount = (qs: readonly GapQuestion[]): number => qs.filter((q) => q.state === "open").length;

/** Levels an answer may be stored at: the item's own level or more restricted (the message names the item). */
export function levelChoices(itemLevel: AccessLevel): AccessLevel[] {
  return ACCESS_LEVELS.filter((l) => levelRank(l) >= levelRank(itemLevel));
}

const ROLES_WHO_READ: readonly AppRole[] = ["advisor", "treasurer", "incoming_lead", "member"];

/**
 * Who can read the item now but would not once an answer at `chosen` raises it (a done, not
 * done, approver or date answer is evidence, and evidence raises an item to its level). The
 * outgoing lead keeps it: the answer is theirs. "I don't know" is a note with its own level, so
 * it raises nothing.
 */
export function rolesLosingSight(itemLevel: AccessLevel, chosen: AccessLevel, answer: AnswerKind): string[] {
  if (answer === "unknown" || levelRank(chosen) <= levelRank(itemLevel)) return [];
  const reads = (role: AppRole, level: AccessLevel) => canRead({ role, userId: "x", level, privateUploaders: ["lead"], releasedToRole: false });
  return ROLES_WHO_READ.filter((r) => reads(r, itemLevel) && !reads(r, chosen)).map((r) => ROLE_LABELS[r]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2027-01-05" -> "5 Jan 2027", as Postgres to_char(date, 'FMDD Mon YYYY'). */
export function dayInWords(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The message answer_gap() stores for an answer. Keep in step with migration 0022. */
export function statementText(input: { question: QuestionKind; answer: AnswerKind; description: string; approver?: string | null; nextDue?: string | null; detail?: string | null }): string {
  const subject = input.description.trim().replace(/[\s.]+$/, "");
  const head = (() => {
    switch (input.answer) {
      case "done":
        return `Done: ${subject}.`;
      case "not_done":
        return `Not done: ${subject}.`;
      case "approver":
        return `Needs approval from ${squash(input.approver)}: ${subject}.`;
      case "no_approval":
        return `No approval is needed: ${subject}.`;
      case "date":
        return `Next due on ${dayInWords(input.nextDue ?? "")}: ${subject}.`;
      default:
        return `${input.question === "approver" ? "Not known who approves it" : input.question === "date" ? "Not known when it is next due" : "Not known whether it was done"}: ${subject}.`;
    }
  })();
  const detail = squash(input.detail);
  return detail ? `${head} ${detail}` : head;
}

/** What an answer did, in words, for the answered list. */
export function answerSummary(a: Pick<QuestionAnswer, "question" | "answer">): string {
  if (a.answer === "unknown") return "You said you don't know. It is handed over as unknown, and you can answer later.";
  if (a.question === "conflict") return "Your answer is added as a record. The conflict stays until the advisor rules.";
  if (a.answer === "done") return "Recorded as done, on your word.";
  if (a.answer === "not_done") return "Recorded as not done, on your word: it is still owed.";
  if (a.answer === "no_approval") return "Recorded: no approval is needed.";
  if (a.answer === "approver") return "The approver is recorded, on your word.";
  return "The next due date is recorded, on your word.";
}
