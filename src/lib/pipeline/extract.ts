// Commitment extraction: chunk events, ask the model for candidates, then keep only those
// that pass deterministic checks. Pure functions; database I/O lives in run-extraction.ts.

import { z } from "zod";
import { formatIst } from "../format.ts";
import { normaliseForQuote, verifyQuote } from "./verify.ts";

export type PipelineEvent = {
  id: string;
  author: string | null;
  ts: string | null;
  text: string;
  threadId: string | null;
  sourceType: "whatsapp" | "trello" | "minutes";
};

export type Chunk = { events: PipelineEvent[] };

export const CHUNK_MAX_EVENTS = 60;
export const CHUNK_MAX_CHARS = 12_000;

/**
 * Group events by thread (a chat day, a Trello card, a meeting) in time order, then pack
 * whole threads of the same source type into chunks. A thread bigger than a chunk is split.
 */
export function chunkEvents(events: PipelineEvent[], maxEvents = CHUNK_MAX_EVENTS, maxChars = CHUNK_MAX_CHARS): Chunk[] {
  const threads = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const key = `${e.sourceType}|${e.threadId ?? e.id}`;
    const list = threads.get(key);
    if (list) list.push(e);
    else threads.set(key, [e]);
  }
  const chunks: Chunk[] = [];
  let current: PipelineEvent[] = [];
  let chars = 0;
  let type: PipelineEvent["sourceType"] | null = null;
  const flush = () => {
    if (current.length) chunks.push({ events: current });
    current = [];
    chars = 0;
    type = null;
  };
  for (const thread of threads.values()) {
    const tChars = thread.reduce((n, e) => n + e.text.length, 0);
    if (current.length && (type !== thread[0].sourceType || current.length + thread.length > maxEvents || chars + tChars > maxChars)) {
      flush();
    }
    for (const e of thread) {
      if (current.length && (current.length >= maxEvents || chars + e.text.length > maxChars)) flush();
      current.push(e);
      chars += e.text.length;
      type = e.sourceType;
    }
  }
  flush();
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
- anything you would have to guess.

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
    const when = e.ts ? formatIst(e.ts) : "undated";
    const kind = e.sourceType === "whatsapp" ? "Chat" : e.sourceType === "trello" ? "Trello" : "Minutes";
    const body = e.text.replace(/\n/g, "\n    ");
    return `[${ref}] ${when} | ${kind} | ${e.author ?? "Unknown"}: ${body}`;
  });
  return { user: `Records (times in IST):\n\n${lines.join("\n")}`, refs };
}

export type Candidate = {
  event: PipelineEvent;
  quote: string;
  owedBy: string;
  owedTo: string;
  deliverable: string;
  dueText: string | null;
};

export type DropReason = "unknown_message" | "quote_not_found" | "quote_too_short" | "non_binding" | "no_counterparty" | "no_deliverable" | "duplicate";

// Deterministic backstop for the prompt's "ignore hedged statements" rule.
const HEDGE = /\b(maybe|might|will see|not sure|probably|perhaps|someday|if possible|try to)\b/i;
const NO_PARTY = /^(unknown|none|n\/?a|nobody|no one|unspecified|-|\?)$/i;

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
    if (HEDGE.test(c.quote)) {
      drop("non_binding");
      continue;
    }
    const owedTo = c.owed_to.trim();
    if (!owedTo || NO_PARTY.test(owedTo)) {
      drop("no_counterparty");
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
    kept.push({ event, quote: c.quote.trim(), owedBy: c.owed_by.trim() || event.author || "Unknown", owedTo, deliverable, dueText });
  }
  return { kept, dropped };
}
