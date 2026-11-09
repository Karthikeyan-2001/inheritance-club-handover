// Rule-based stand-ins for the duty finder and the follow-up check, used only with
// LLM_PROVIDER=fake (tests and offline e2e). They read the same prompts a real model would
// and return quotes copied from them, so the deterministic checks downstream are exercised.

import type { ProviderRequest } from "../llm/types.ts";
import type { DutyOutput } from "./cycles.ts";
import { RECURRENCE } from "./cycles.ts";
import type { DutyContextOutput, FollowupOutput } from "./fulfilment.ts";
import type { MatchOutput } from "./match.ts";
import { contentTokens, sentences } from "./text.ts";

type Block = { ref: string; author: string; text: string };

const LINE = /^\[(m\d+)\] [^|]*\| [^|]*\| ([^:]+): (.*)$/;

/** The `[mN] … | … | Author: text` records of a prompt, with continuation lines joined. */
export function parseRecordBlocks(user: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of user.split("\n")) {
    const m = raw.match(LINE);
    if (m) blocks.push({ ref: m[1], author: m[2].trim(), text: m[3] });
    else if (blocks.length && raw.startsWith("    ")) blocks[blocks.length - 1].text += `\n${raw.slice(4)}`;
  }
  return blocks;
}

const APPROVER = /\b(HoD|Dean's office|Dean|Principal|Student Affairs)\b/;
const LEAD = /\b(?:a|an|one|two|three|\d+) (?:months?|weeks?|days?) ahead\b/i;

export function fakeDuties(request: ProviderRequest): DutyOutput {
  const byKey = new Map<string, DutyOutput["duties"][number]>();
  for (const b of parseRecordBlocks(request.user)) {
    for (const rawLine of b.text.split("\n")) {
      const line = rawLine.replace(/^(?:-\s+|Card:\s+)/, "").trim();
      const cue = line.match(RECURRENCE);
      if (!cue || line.length > 240) continue;
      const approver = line.match(APPROVER)?.[1] ?? b.text.match(APPROVER)?.[1] ?? null;
      const key = approver ?? line;
      const quote = { message: b.ref, quote: line, role: "rule" as const };
      const existing = byKey.get(key);
      if (existing) {
        existing.quotes.push(quote);
        continue;
      }
      const lower = line.toLowerCase();
      byKey.set(key, {
        duty: line.replace(/[.!]+$/, ""),
        period: /semester|\bsem\b/.test(lower) ? "semester" : /annual|year/.test(lower) ? "year" : /before every|each/.test(lower) ? "each_time" : "other",
        cadence_words: cue[0],
        when_words: null,
        approval: approver ? `Approval from the ${approver}` : null,
        approver,
        lead_time_words: line.match(LEAD)?.[0] ?? null,
        usual_owner: null,
        quotes: [quote],
      });
    }
  }
  return { duties: [...byKey.values()] };
}

const NOT_DONE = /\b(not|nobody|haven't|hasn't|never|still)\b.*\b(sent|received|done|returned|paid|working|works|asking)\b/i;
const DONE = /\b(done|sent|returned|printed|delivered|submitted|completed|paid|reimbursed)\b|moved card .* to "Done"/i;
const IMPLIES = /\b(are up|is up|went well|collected)\b/i;
const FUTURE = /\b(will|to be|going to|plan)\b/i;
const DEPENDS = /\b(once|after|only if|until)\b/i;

export function fakeFollowup(request: ProviderRequest): FollowupOutput {
  const head = request.user.split("\n\nRecords")[0];
  const promiseRefs = new Set(head.match(/\bm\d+\b/g) ?? []);
  // What the item is about: its description and the promise, not the people (names link unrelated tasks).
  const want = contentTokens(head.split("\n").filter((l) => /^(Commitment|Recurring duty|The promise)/.test(l)).join(" "));
  const followups: FollowupOutput["followups"] = [];
  const context: FollowupOutput["context"] = [];
  for (const b of parseRecordBlocks(request.user)) {
    for (const s of sentences(b.text)) {
      // About this item: at least half of the sentence's content words appear in the item.
      const words = [...contentTokens(s)];
      if (words.length === 0 || words.filter((w) => want.has(w)).length * 2 < words.length) continue;
      if (context.length < 2 && DEPENDS.test(s)) context.push({ message: b.ref, quote: s, kind: "dependency", note: `This depends on: ${s}` });
      if (promiseRefs.has(b.ref)) continue;
      if (FUTURE.test(s)) continue;
      if (NOT_DONE.test(s)) followups.push({ message: b.ref, quote: s, kind: "not_done" });
      else if (DONE.test(s)) followups.push({ message: b.ref, quote: s, kind: "done" });
      else if (IMPLIES.test(s)) followups.push({ message: b.ref, quote: s, kind: "implies_done" });
    }
  }
  return { followups, context };
}

const RISK = /\b(rejected|without it|problem|issue|late)\b/i;

export function fakeDutyContext(request: ProviderRequest): DutyContextOutput {
  const context: DutyContextOutput["context"] = [];
  for (const b of parseRecordBlocks(request.user)) {
    for (const s of sentences(b.text)) {
      if (context.length < 3 && RISK.test(s)) context.push({ message: b.ref, quote: s, kind: "risk", note: `Watch out: ${s}` });
    }
  }
  return { context };
}

const ITEM = /^ {2}[AB]: (?:Commitment|Recurring duty): ([^|]*)/;

/** Same when the two descriptions share most content words; unsure when some; else different. */
export function fakeMatch(request: ProviderRequest): MatchOutput {
  const verdicts: MatchOutput["verdicts"] = [];
  for (const block of request.user.split("\n\n")) {
    const ref = block.match(/^Pair (p\d+)/)?.[1];
    if (!ref) continue;
    const [a, b] = block.split("\n").map((l) => l.match(ITEM)?.[1]).filter((d): d is string => Boolean(d)).map((d) => contentTokens(d));
    if (!a || !b) continue;
    const shared = [...a].filter((t) => b.has(t)).length;
    const overlap = shared / Math.max(1, a.size + b.size - shared);
    verdicts.push({ pair: ref, verdict: overlap >= 0.4 ? "same" : overlap >= 0.2 ? "unsure" : "different" });
  }
  return { verdicts };
}
