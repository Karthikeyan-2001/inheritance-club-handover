// Commitment extraction: chunk events, ask the model for candidates, then keep only those
// that pass deterministic checks. Pure functions; database I/O lives in run-pipeline.ts.

import { z } from "zod";
import type { AccessLevel } from "../access.ts";
import { formatIst } from "../format.ts";
import { contentTokens, sentences } from "./text.ts";
import { noteGrounded, normaliseForQuote, verifyQuote } from "./verify.ts";

export type PipelineEvent = {
  id: string;
  author: string | null;
  ts: string | null;
  text: string;
  threadId: string | null;
  sourceType: "whatsapp" | "trello" | "minutes";
  /** The message's own access level, when known (the database always knows it). */
  accessLevel?: AccessLevel;
  /** Who uploaded the file the message came from (matters for private files). */
  uploaderId?: string | null;
  /** The file the message came from, when known (the trust rule counts distinct files). */
  sourceId?: string | null;
};

/**
 * Messages with the same key may share one model prompt. A prompt never mixes access levels,
 * or private files of different uploaders: anything the model writes from it (a description,
 * a note) is then stored at a level that every message it saw allows.
 */
export function visibilityKey(e: Pick<PipelineEvent, "accessLevel" | "uploaderId">): string {
  const level = e.accessLevel ?? "everyone";
  return level === "private" ? `private:${e.uploaderId ?? "unknown"}` : level;
}

export type Chunk = { events: PipelineEvent[] };

export const CHUNK_MAX_EVENTS = 60;
export const CHUNK_MAX_CHARS = 12_000;

/**
 * Group events by thread (a chat day, a Trello card, a meeting) in time order, then pack
 * whole threads of the same source type and visibility into chunks. A thread bigger than a
 * chunk is split. Threads are packed group by group, so files read in time order (as the
 * database returns them, with two chats interleaving day by day) make as few chunks as files
 * read one after another; a chunk never mixes visibility or source type.
 */
export function chunkEvents(events: PipelineEvent[], maxEvents = CHUNK_MAX_EVENTS, maxChars = CHUNK_MAX_CHARS): Chunk[] {
  const threads = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const key = `${visibilityKey(e)}|${e.sourceType}|${e.threadId ?? e.id}`;
    const list = threads.get(key);
    if (list) list.push(e);
    else threads.set(key, [e]);
  }
  // Threads by group (visibility and source type), each group in order of first appearance.
  const groups = new Map<string, PipelineEvent[][]>();
  for (const thread of threads.values()) {
    const g = `${visibilityKey(thread[0])}|${thread[0].sourceType}`;
    const list = groups.get(g);
    if (list) list.push(thread);
    else groups.set(g, [thread]);
  }
  const chunks: Chunk[] = [];
  let current: PipelineEvent[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length) chunks.push({ events: current });
    current = [];
    chars = 0;
  };
  for (const group of groups.values()) {
    for (const thread of group) {
      const tChars = thread.reduce((n, e) => n + e.text.length, 0);
      if (current.length && (current.length + thread.length > maxEvents || chars + tChars > maxChars)) flush();
      for (const e of thread) {
        if (current.length && (current.length >= maxEvents || chars + e.text.length > maxChars)) flush();
        current.push(e);
        chars += e.text.length;
      }
    }
    flush();
  }
  return chunks;
}

export const ExtractionSchema = z.object({
  commitments: z.array(
    z.object({
      message: z.string().describe("The reference of the message that contains the commitment, e.g. m3"),
      quote: z.string().describe("Words copied exactly from that message that state the commitment"),
      owed_by: z.string().describe("Who made the commitment, as named in the messages"),
      owed_to: z.string().describe("Who is owed it: a person, group or organisation"),
      deliverable: z.string().describe("What will be done or given, in a few words"),
      due_text: z.string().nullable().describe("The deadline exactly as written, or null if none"),
    }),
  ),
});
export type ExtractionOutput = z.infer<typeof ExtractionSchema>;

export const EXTRACTION_SYSTEM = `You read records from a university student club (chat messages, Trello activity, meeting minutes) and list the commitments in them.

A commitment is a firm promise, or an assigned action, by a specific person or the committee to do or give something for a specific person, group or organisation. Examples: "I will send the certificates to the speakers by 15 March", "Divya to reimburse Mr. Ganesan once the bills arrive".

Do not list:
- hedged or non-binding statements ("maybe I'll check", "will see", "we should probably", "might", "not sure");
- questions, requests to others that nobody accepted, general wishes, or reports that something is already done;
- anything you would have to guess;
- general rules that apply every time ("a permission letter is needed before every lab booking"). Those are recurring duties and are found separately. A specific person's promise to do it this time is still a commitment.

For each commitment:
- message: the reference in square brackets at the start of the message, e.g. m3.
- quote: copy the words exactly as they appear in that one message, including spelling mistakes. Quote only from that message. Keep it short but complete enough to show the promise.
- owed_by: who promised. If the speaker says "I" or "we", use the speaker's name.
- owed_to: who is waiting for it. Use "the club" or "the committee" only when that is truly who is owed.
- deliverable: what will be done, in a few plain words.
- due_text: the deadline words as written ("by 15 March", "by Friday"), or null.

If there are no commitments, return an empty list.`;

/** The user turn: each event on its own line with a short reference the model cites. */
export function buildExtractionPrompt(chunk: Chunk): { user: string; refs: Map<string, PipelineEvent> } {
  const refs = new Map<string, PipelineEvent>();
  const lines = chunk.events.map((e, i) => {
    const ref = `m${i + 1}`;
    refs.set(ref, e);
    return recordLine(ref, e);
  });
  return { user: `Records (times in IST):\n\n${lines.join("\n")}`, refs };
}

/** One record as the model sees it: `[m3] 2 Mar 2026, 7:42 pm IST | Chat | Arun: text`. */
export function recordLine(ref: string, e: PipelineEvent): string {
  const when = e.ts ? formatIst(e.ts) : "undated";
  const kind = e.sourceType === "whatsapp" ? "Chat" : e.sourceType === "trello" ? "Trello" : "Minutes";
  const body = e.text.replace(/\n/g, "\n    ");
  return `[${ref}] ${when} | ${kind} | ${e.author ?? "Unknown"}: ${body}`;
}

export type Candidate = {
  event: PipelineEvent;
  quote: string;
  owedBy: string;
  owedTo: string;
  deliverable: string;
  dueText: string | null;
};

export type DropReason =
  | "unknown_message" | "quote_not_found" | "quote_too_short" | "non_binding" | "no_counterparty" | "no_deliverable" | "duplicate"
  | "card_without_counterparty"
  /** Not dropped: the claim is kept, but its description is replaced by the verified quote. */
  | "ungrounded_deliverable";

/**
 * The model writes the deliverable; it may not name a person, organisation or number missing
 * from the promise's own message (or its author). The first word is usually a verb ("Print
 * fest posters"), so it is only checked when it looks like a name or code (an inner capital
 * or a digit, as in "IoT" or "ESP32").
 */
export function deliverableGrounded(deliverable: string, eventText: string, author: string | null): boolean {
  const first = deliverable.trim().split(/\s+/)[0] ?? "";
  const nameLike = /[\p{Lu}\d]/u.test(first.slice(1));
  const text = nameLike ? deliverable : deliverable.trim().replace(first, first.toLowerCase());
  return noteGrounded(text, eventText, author ?? "");
}

// Deterministic backstop for the prompt's "ignore hedged statements" rule. Includes Tamil-English
// hedges written in Latin script ("paakalam", "let's see"; "theriyala", "don't know").
export const HEDGE = /\b(maybe|might|will see|not sure|probably|perhaps|someday|if possible|try to|paa?r?k+alaa?m|paarpo?m|theriyala)\b/i;

/**
 * Is the quote hedged, by its own words or by the rest of its sentence? A quote can leave the
 * hedge out ("I'll shoot the convocation too" from "Maybe I'll shoot the convocation too"), so
 * the sentences of the message that the quote sits in are checked as well. A firm promise that
 * shares a sentence with a hedge is dropped too, and counted: safer than keeping a hedge as a promise.
 */
export function hedged(quote: string, messageText: string): boolean {
  if (HEDGE.test(quote)) return true;
  const q = normaliseForQuote(quote);
  if (!q) return false;
  const head = q.slice(0, 24);
  const tail = q.slice(-24);
  return sentences(messageText).some((s) => {
    const n = normaliseForQuote(s);
    return (n.includes(q) || q.includes(n) || n.includes(head) || n.includes(tail)) && HEDGE.test(s);
  });
}
const NO_PARTY = /^(unknown|none|n\/?a|nobody|no one|unspecified|-|\?)$/i;

/** A Trello card or checklist as a whole (not a comment or a move): a to-do list, not a conversation. */
export const isTrelloCard = (e: Pick<PipelineEvent, "sourceType" | "text">): boolean =>
  e.sourceType === "trello" && /^(Card: |Checklist ")/.test(e.text);

// Words that name the club itself, not someone outside it who is waiting.
const SELF = new Set(["club", "committee", "team", "member", "members", "us", "we", "everyone", "all", "iot", "core", "board"].map((w) => [...contentTokens(w)][0] ?? w));

/**
 * Does the card itself name who is waiting for it ("Send sponsorship proposal to Brightwave
 * Labs")? Words that only name the club do not count.
 */
export function cardNamesCounterparty(owedTo: string, cardText: string): boolean {
  const want = [...contentTokens(owedTo)].filter((w) => !SELF.has(w));
  if (!want.length) return false;
  const have = contentTokens(cardText);
  return want.some((w) => have.has(w));
}

/** Keep only candidates that cite a real message, quote it verbatim, and are firm and complete. */
export function postProcess(output: ExtractionOutput, refs: Map<string, PipelineEvent>): { kept: Candidate[]; dropped: Partial<Record<DropReason, number>> } {
  const kept: Candidate[] = [];
  const dropped: Partial<Record<DropReason, number>> = {};
  const drop = (r: DropReason) => (dropped[r] = (dropped[r] ?? 0) + 1);
  const seen = new Set<string>();

  for (const c of output.commitments) {
    const event = refs.get(c.message.trim().replace(/^\[|\]$/g, ""));
    if (!event) {
      drop("unknown_message");
      continue;
    }
    const check = verifyQuote(c.quote, event.text);
    if (!check.ok) {
      drop(check.reason);
      continue;
    }
    if (hedged(c.quote, event.text)) {
      drop("non_binding");
      continue;
    }
    const owedTo = c.owed_to.trim();
    if (!owedTo || NO_PARTY.test(owedTo)) {
      drop("no_counterparty");
      continue;
    }
    // A card is a to-do item. It counts as a commitment only with a person waiting for it, or a
    // due date someone took on; "Count what the lab has" or "Keep updated with receipts" has neither.
    if (isTrelloCard(event) && !/\nDue: /.test(event.text) && !cardNamesCounterparty(owedTo, event.text)) {
      drop("card_without_counterparty");
      continue;
    }
    const deliverable = c.deliverable.trim();
    const dueText = c.due_text?.trim() || null;
    if (deliverable.length < 3 && !dueText) {
      drop("no_deliverable");
      continue;
    }
    const key = `${event.id}|${normaliseForQuote(c.quote)}`;
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    seen.add(key);
    let description = deliverable;
    if (description && !deliverableGrounded(description, event.text, event.author)) {
      drop("ungrounded_deliverable");
      description = c.quote.trim();
    }
    kept.push({ event, quote: c.quote.trim(), owedBy: c.owed_by.trim() || event.author || "Unknown", owedTo, deliverable: description, dueText });
  }
  return { kept, dropped };
}
