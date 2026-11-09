// Follow-up for one obligation: what happened to a commitment after it was made (fulfilment
// evidence), and what the next committee should know about it (context). The model proposes
// quotes; code keeps only those that cite a real message, are verbatim, and make sense in
// time. Status is then derived from the kept evidence alone (status.ts / SQL).

import { z } from "zod";
import { HEDGE, recordLine, type PipelineEvent } from "./extract.ts";
import { byTime, timeOf } from "./related.ts";
import { normaliseForQuote, verifyQuote } from "./verify.ts";

export type FollowupTarget = {
  obligationId: string;
  kind: "commitment" | "recurring";
  description: string;
  owedBy: string | null;
  owedTo: string | null;
  dueText: string | null;
  cadence: string | null;
  approver: string | null;
  /** Messages the obligation is built from ('supports' evidence). */
  sourceEventIds: string[];
  sourceQuotes: string[];
};

const ref = z.string().describe("The reference of the message, e.g. m3");
const quote = z.string().describe("Words copied exactly from that one message");
const contextItem = z.object({
  message: ref,
  quote,
  kind: z.enum(["decision", "contact", "risk", "dependency"]),
  note: z.string().describe("One short plain sentence for the next committee"),
});

export const FollowupSchema = z.object({
  followups: z.array(z.object({ message: ref, quote, kind: z.enum(["done", "implies_done", "not_done"]) })),
  context: z.array(contextItem),
});
export type FollowupOutput = z.infer<typeof FollowupSchema>;

export const DutyContextSchema = z.object({ context: z.array(contextItem) });
export type DutyContextOutput = z.infer<typeof DutyContextSchema>;

const QUOTE_RULES = `For every item give the message reference in square brackets at the start of the message (e.g. m3), and a quote copied exactly from that one message, including spelling mistakes. Keep quotes short but complete.`;

const CONTEXT_RULES = `context: up to 5 facts the next committee should know about this obligation, each stated in a message:
- decision: something decided about it.
- contact: a person or organisation involved, and their role or how to reach them.
- risk: something that went wrong before or could go wrong.
- dependency: something that has to happen first.
note: one short plain sentence that uses only facts from the quoted message. Do not repeat the obligation itself, and do not guess.`;

export const FOLLOWUP_SYSTEM = `You check what happened to one commitment made in a university student club, using the club's own records (chat messages, Trello activity, meeting minutes).

Return two lists.

followups: messages dated after the promise that report on this same commitment.
- done: says plainly that it was done or delivered ("Returned all 8 boards", a Trello card moved to Done).
- implies_done: does not say it was done, but describes something that only makes sense if it was ("Posters are up on all notice boards").
- not_done: says it was not done, is still pending, or disputes that it was done ("Speakers are still asking for their certificates").
Plans, reminders, questions and repeated promises are not follow-ups. A message about a different task is not a follow-up, even if it uses similar words.

${CONTEXT_RULES}

${QUOTE_RULES}
If nothing fits a list, return it empty.`;

export const DUTY_CONTEXT_SYSTEM = `You read the records of a university student club about one of its recurring duties, and note what the next committee should know about it.

${CONTEXT_RULES}

${QUOTE_RULES}
If nothing fits, return an empty list.`;

/** The user turn: the obligation, then related records with short references. */
export function buildFollowupPrompt(target: FollowupTarget, events: readonly PipelineEvent[]): { user: string; refs: Map<string, PipelineEvent> } {
  const refs = new Map<string, PipelineEvent>();
  const sorted = [...events].sort(byTime);
  const refOf = new Map<string, string>();
  const lines = sorted.map((e, i) => {
    const r = `m${i + 1}`;
    refs.set(r, e);
    refOf.set(e.id, r);
    return recordLine(r, e);
  });
  const sourceRefs = target.sourceEventIds.map((id) => refOf.get(id)).filter(Boolean);
  const head =
    target.kind === "commitment"
      ? [
          `Commitment: ${target.description}`,
          `Promised by: ${target.owedBy ?? "not stated"}. Owed to: ${target.owedTo ?? "not stated"}. Due: ${target.dueText ?? "not stated"}.`,
          `The promise is in ${sourceRefs.length ? sourceRefs.join(", ") : "a message not shown"}: ${target.sourceQuotes.map((q) => `"${q}"`).join("; ")}`,
        ]
      : [
          `Recurring duty: ${target.description}`,
          `How often: ${target.cadence ?? "not stated"}. Approval from: ${target.approver ?? "not stated"}.`,
          `Stated in ${sourceRefs.length ? sourceRefs.join(", ") : "messages not shown"}.`,
        ];
  return { user: `${head.join("\n")}\n\nRecords (times in IST), oldest first:\n\n${lines.join("\n")}`, refs };
}

export type KeptEvidence = { event: PipelineEvent; quote: string; relation: "fulfils" | "contradicts"; inferred: boolean };
export type KeptContext = { event: PipelineEvent; quote: string; kind: "decision" | "contact" | "risk" | "dependency"; note: string };

export type FollowupDropReason =
  | "unknown_message" | "quote_not_found" | "quote_too_short" | "cites_promise" | "before_promise" | "undated"
  | "non_binding" | "question" | "no_note" | "ungrounded_note" | "over_limit" | "duplicate";

export const MAX_CONTEXT = 5;
const MAX_NOTE = 300;

// Capitalised words that commonly start or fill a note without naming anyone.
const NOTE_WORDS = new Set(
  `a an the this that these those it its they them their he she his her we our you your i ask get book send make check keep do
  don't need needs must should contact before after only if when apply talk remind note watch confirm collect pay return submit
  bring use plan start call email message follow wait from with for and or but not no yes also once until by on in at to of`.split(/\s+/),
);

/**
 * A context note is stored at the level of the one message it cites, but the model wrote it
 * having seen other messages too. So a note may not name a person, organisation or number
 * that is absent from that message (and from the obligation it is attached to).
 */
export function noteGrounded(note: string, eventText: string, targetText: string): boolean {
  const known = normaliseForQuote(`${eventText} ${targetText}`);
  const knownDigits = known.replace(/[,\s]/g, "");
  for (const m of note.matchAll(/[\p{Lu}][\p{L}'.-]*|\d[\d,.]*/gu)) {
    const w = m[0].replace(/[.,']+$/, "");
    if (/^\d/.test(w)) {
      if (!knownDigits.includes(w.replace(/,/g, ""))) return false;
      continue;
    }
    const lower = w.toLowerCase();
    if (NOTE_WORDS.has(lower) || lower.length < 2) continue;
    if (!known.includes(lower)) return false;
  }
  return true;
}

/** Keep only follow-ups and context that cite a real message verbatim and fit in time. */
export function postProcessFollowup(
  output: { followups?: FollowupOutput["followups"]; context: FollowupOutput["context"] },
  refs: Map<string, PipelineEvent>,
  target: Pick<FollowupTarget, "sourceEventIds" | "description" | "owedBy" | "owedTo" | "approver">,
): { evidence: KeptEvidence[]; context: KeptContext[]; dropped: Partial<Record<FollowupDropReason, number>> } {
  const dropped: Partial<Record<FollowupDropReason, number>> = {};
  const drop = (r: FollowupDropReason) => (dropped[r] = (dropped[r] ?? 0) + 1);
  const sources = new Set(target.sourceEventIds);
  const sourceTimes = [...refs.values()].filter((e) => sources.has(e.id) && e.ts).map(timeOf);
  const since = sourceTimes.length ? Math.min(...sourceTimes) : null;

  const resolve = (message: string, q: string): PipelineEvent | null => {
    const event = refs.get(message.trim().replace(/^\[|\]$/g, ""));
    if (!event) {
      drop("unknown_message");
      return null;
    }
    const check = verifyQuote(q, event.text);
    if (!check.ok) {
      drop(check.reason);
      return null;
    }
    return event;
  };

  const evidence: KeptEvidence[] = [];
  const seen = new Set<string>();
  for (const f of output.followups ?? []) {
    const event = resolve(f.message, f.quote);
    if (!event) continue;
    if (sources.has(event.id)) {
      drop("cites_promise");
      continue;
    }
    if (!event.ts) {
      drop("undated");
      continue;
    }
    if (since === null || timeOf(event) < since) {
      drop("before_promise");
      continue;
    }
    if (f.kind !== "not_done" && HEDGE.test(f.quote)) {
      drop("non_binding");
      continue;
    }
    if (f.kind !== "not_done" && f.quote.trim().endsWith("?")) {
      drop("question");
      continue;
    }
    const relation = f.kind === "not_done" ? "contradicts" : "fulfils";
    const key = `${event.id}|${normaliseForQuote(f.quote)}`;
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    seen.add(key);
    evidence.push({ event, quote: f.quote.trim(), relation, inferred: f.kind === "implies_done" });
  }

  const context: KeptContext[] = [];
  const seenCtx = new Set<string>();
  for (const c of output.context) {
    const event = resolve(c.message, c.quote);
    if (!event) continue;
    const note = c.note.trim();
    if (!note || note.length > MAX_NOTE) {
      drop("no_note");
      continue;
    }
    if (!noteGrounded(note, event.text, [target.description, target.owedBy, target.owedTo, target.approver].filter(Boolean).join(" "))) {
      drop("ungrounded_note");
      continue;
    }
    const key = `${c.kind}|${event.id}|${normaliseForQuote(c.quote)}`;
    if (seenCtx.has(key)) {
      drop("duplicate");
      continue;
    }
    if (context.length >= MAX_CONTEXT) {
      drop("over_limit");
      continue;
    }
    seenCtx.add(key);
    context.push({ event, quote: c.quote.trim(), kind: c.kind, note });
  }
  return { evidence, context, dropped };
}
