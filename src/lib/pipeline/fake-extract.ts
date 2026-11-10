// Rule-based stand-in for the extraction model, used only with LLM_PROVIDER=fake (tests and
// offline e2e). It reads the same prompt format a real model would and returns candidates.

import type { ProviderRequest } from "../llm/types.ts";
import { RECURRENCE } from "./cycles.ts";
import type { ExtractionOutput } from "./extract.ts";
import { sentences } from "./text.ts";

const LINE = /^\[(m\d+)\] [^|]*\| [^|]*\| ([^:]+): (.*)$/;
const PROMISE = /\b(I will|I'll|we will|we'll|I will have)\b[^.!?\n]*/i;
const PROMISE_TO_END = /\b(I will|I'll|we will|we'll|I will have)\b.*$/i;
const ACTION = /^-?\s*([A-Z][a-z]+) to (.+?)\.?\s*$/m;

export function fakeExtract(request: ProviderRequest): ExtractionOutput {
  const commitments: ExtractionOutput["commitments"] = [];
  const blocks: { ref: string; author: string; text: string }[] = [];
  for (const raw of request.user.split("\n")) {
    const m = raw.match(LINE);
    if (m) blocks.push({ ref: m[1], author: m[2].trim(), text: m[3] });
    else if (blocks.length && raw.startsWith("    ")) blocks[blocks.length - 1].text += `\n${raw.slice(4)}`;
  }
  for (const b of blocks) {
    // The promise runs from "I will" to the end of its sentence (titles such as "Mr." do not end it).
    const sentence = sentences(b.text).find((s) => PROMISE.test(s));
    const p = sentence?.match(PROMISE_TO_END);
    if (p) {
      const quote = p[0].trim().replace(/[.!?]+$/, "");
      const to = quote.match(/\bto (?:all )?([A-Z][\w.]*(?: [A-Z][\w.]*)*|workshop speakers|the [a-z]+)/)?.[1] ?? "the club";
      commitments.push({ message: b.ref, quote, owed_by: b.author, owed_to: to, deliverable: quote.replace(PROMISE.exec(quote)?.[1] ?? "", "").trim(), due_text: quote.match(/\bby [^,.]+/)?.[0] ?? null });
    }
    // A Trello card with a due date is a task someone took on (the card restates it).
    const card = b.text.match(/^Card: ([^\n]+)/);
    if (card && /\nDue: /.test(b.text) && !RECURRENCE.test(b.text)) {
      const name = card[1].trim();
      const to = name.match(/\bto (?:all )?([A-Z][\w.]*(?: [A-Z][\w.]*)*|workshop speakers|the [a-z]+)/)?.[1] ?? "the club";
      commitments.push({ message: b.ref, quote: `Card: ${name}`, owed_by: b.author, owed_to: to, deliverable: name, due_text: b.text.match(/\nDue: ([^\n]+)/)?.[1] ?? null });
    }
    for (const line of b.text.split("\n")) {
      const a = line.match(ACTION);
      if (a) commitments.push({ message: b.ref, quote: `${a[1]} to ${a[2]}`.trim(), owed_by: a[1], owed_to: "the committee", deliverable: a[2].trim(), due_text: a[2].match(/\bby [^,.]+/)?.[0] ?? null });
    }
  }
  return { commitments };
}
