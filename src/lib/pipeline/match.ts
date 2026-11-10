// Matching: finding items that are the same obligation recorded twice (a chat promise and the
// Trello card for it; a duty stated in the chat and again in the minutes). Code scores every
// pair of items of the same kind on their wording (trigram similarity, as pg_trgm computes it,
// and shared content words), the people they are owed to or approved by (through the alias
// table), and, for commitments, how close in time they were made. Near-identical pairs are
// linked by rule; the uncertain middle goes to the model, which only answers "same",
// "different" or "unsure" per pair. Unsure becomes a possible match, shown but never used as
// evidence. Items are linked, never merged (migration 0011).

import { z } from "zod";
import type { AccessLevel } from "../access.ts";
import { formatIst } from "../format.ts";
import { timeOf } from "./related.ts";
import { contentTokens, trigramSimilarity } from "./text.ts";

export type MatchItem = {
  id: string;
  kind: "commitment" | "recurring";
  description: string;
  owedBy: string | null;
  owedTo: string | null;
  dueText: string | null;
  cadence: string | null;
  approver: string | null;
  level: AccessLevel;
  /** The messages that state the item ('supports' evidence). */
  sources: { eventId: string; quote: string; ts: string | null; sourceType: "whatsapp" | "trello" | "minutes" }[];
};

export type Alias = { canonical: string; variants: readonly string[] };

export type MatchPair = { a: string; b: string; score: number };

/**
 * Linked as the same by rule only when both the trigram similarity and the shared-word ratio
 * reach this, the people are compatible, and no number differs ("6 sensors" against "8").
 */
export const RULE_SAME = 0.7;
/** Pairs scoring at least this (lower when they share a person or a message) go to the model. */
export const ASK = 0.3;
const ASK_SHARED_PARTY = 0.2;
const ASK_SHARED_SOURCE = 0.1;
/** With different people named on each side, only near-identical wording is worth asking about. */
const ASK_PARTY_CONFLICT = 0.5;
/** Commitments made this far apart are different occasions (this year's booking, last year's). */
export const WINDOW_DAYS = 60;
/** At most this many pairs go to the model per run, best first. */
export const MAX_ASK = 48;
export const PAIRS_PER_CALL = 8;

// People and groups that say nothing about who is owed.
const GENERIC_PARTY = new Set(["club", "the club", "committee", "the committee", "team", "everyone", "members", "all", "us", "we", "students", "department"]);
const HONORIFIC = new Set(["sir", "madam", "maam", "miss", "prof", "mrs", "labs", "lab", "office", "incharge", "charge"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A person or group as comparable words, with known aliases replaced by their canonical name. */
export function partyTokens(party: string | null, aliases: readonly Alias[]): Set<string> {
  let text = (party ?? "").normalize("NFKC").trim();
  if (!text || GENERIC_PARTY.has(text.toLowerCase())) return new Set();
  for (const a of aliases) {
    for (const name of [a.canonical, ...a.variants].filter((n) => n.trim().length > 1)) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name.trim())}(?=$|[^\\p{L}\\p{N}])`, "giu");
      text = text.replace(re, `$1${a.canonical}`);
    }
  }
  return new Set([...contentTokens(text)].filter((t) => !HONORIFIC.has(t) && !GENERIC_PARTY.has(t)));
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
};

/** Who the item is about: the person owed (commitments) or the approver (duties). */
const partyOf = (i: MatchItem) => (i.kind === "commitment" ? i.owedTo : i.approver);

const numbersIn = (text: string) => new Set(text.match(/\d+/g) ?? []);

const firstTime = (i: MatchItem) => Math.min(...i.sources.map((s) => timeOf(s)), Number.POSITIVE_INFINITY);

export type PairScore = {
  /** The better of the two wording measures; decides whether to ask the model. */
  score: number;
  /** The worse of the two; decides whether to link by rule. */
  floor: number;
  numbersDiffer: boolean;
  sharedParty: boolean;
  partyConflict: boolean;
  sharedSource: boolean;
  withinWindow: boolean;
};

export function scorePair(a: MatchItem, b: MatchItem, aliases: readonly Alias[]): PairScore {
  const trigram = trigramSimilarity(a.description, b.description);
  const words = jaccard(contentTokens(a.description), contentTokens(b.description));
  const na = numbersIn(a.description);
  const nb = numbersIn(b.description);
  const numbersDiffer = na.size > 0 && nb.size > 0 && ([...na].some((n) => !nb.has(n)) || [...nb].some((n) => !na.has(n)));
  const pa = partyTokens(partyOf(a), aliases);
  const pb = partyTokens(partyOf(b), aliases);
  const sharedParty = [...pa].some((t) => pb.has(t));
  const partyConflict = pa.size > 0 && pb.size > 0 && !sharedParty;
  const sharedSource = a.sources.some((s) => b.sources.some((t) => t.eventId === s.eventId));
  let withinWindow = true;
  if (a.kind === "commitment") {
    const ta = firstTime(a);
    const tb = firstTime(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) withinWindow = Math.abs(ta - tb) <= WINDOW_DAYS * 86_400_000;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { score: round(Math.max(trigram, words)), floor: round(Math.min(trigram, words)), numbersDiffer, sharedParty, partyConflict, sharedSource, withinWindow };
}

/** What to do with a pair: link it by rule, ask the model, or leave it. */
export function decide(s: PairScore): "rule" | "ask" | null {
  if (!s.withinWindow) return null;
  if (s.floor >= RULE_SAME && !s.partyConflict && !s.numbersDiffer) return "rule";
  if (s.partyConflict) return s.score >= ASK_PARTY_CONFLICT ? "ask" : null;
  if (s.score >= ASK) return "ask";
  if (s.sharedParty && s.score >= ASK_SHARED_PARTY) return "ask";
  if (s.sharedSource && s.score >= ASK_SHARED_SOURCE) return "ask";
  return null;
}

/** A pair as one string, whichever way round, for sets of pairs a reviewer has ruled on. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Every pair of items of the same kind, scored. Pairs in `skip` (a reviewer said "the same" or
 * "not the same") are never scored again, so a reviewer's verdict stands and costs no model call. Returns the pairs linked by rule, the pairs to
 * ask the model about (best first, at most `maxAsk`), and how many were left out over the limit.
 * Deterministic: the same items give the same pairs in the same order, so saved answers are reused.
 */
export function planMatches(
  items: readonly MatchItem[],
  aliases: readonly Alias[],
  maxAsk = MAX_ASK,
  skip: ReadonlySet<string> = new Set(),
): { rule: MatchPair[]; ask: MatchPair[]; overLimit: number } {
  const sorted = [...items].sort((x, y) => x.id.localeCompare(y.id));
  const rule: MatchPair[] = [];
  const ask: MatchPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.kind !== b.kind) continue;
      if (skip.has(pairKey(a.id, b.id))) continue;
      const s = scorePair(a, b, aliases);
      const d = decide(s);
      if (d === "rule") rule.push({ a: a.id, b: b.id, score: s.score });
      else if (d === "ask") ask.push({ a: a.id, b: b.id, score: s.score });
    }
  }
  ask.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return { rule, ask: ask.slice(0, maxAsk), overLimit: Math.max(0, ask.length - maxAsk) };
}

/** Batches of pairs for the model, each a fixed slice of the ordered list. */
export function batchPairs(pairs: readonly MatchPair[], size = PAIRS_PER_CALL): MatchPair[][] {
  const out: MatchPair[][] = [];
  for (let i = 0; i < pairs.length; i += size) out.push(pairs.slice(i, i + size));
  return out;
}

export const MatchSchema = z.object({
  verdicts: z.array(
    z.object({
      pair: z.string().describe("The pair reference, e.g. p2"),
      verdict: z.enum(["same", "different", "unsure"]),
    }),
  ),
});
export type MatchOutput = z.infer<typeof MatchSchema>;

export const MATCH_SYSTEM = `You compare pairs of items from a university student club's handover ledger. Each item was found in the club's own records (chat messages, Trello activity, meeting minutes), with the words that state it.

For each pair, decide whether A and B are the same obligation recorded twice, for example a promise made in the chat and the Trello card for it, or a duty stated in the chat and again in the minutes.
- same: clearly the same task for the same people (or the same recurring duty with the same approver).
- different: separate tasks, owed to different people, or different occasions (this year's booking and last year's).
- unsure: the records do not let you tell.

Return one verdict for every pair, using its reference (p1, p2, ...). Do not explain.`;

const KIND = { whatsapp: "Chat", trello: "Trello", minutes: "Minutes" } as const;

function itemLines(label: string, i: MatchItem): string[] {
  const parts = [i.kind === "commitment" ? `Commitment: ${i.description}` : `Recurring duty: ${i.description}`];
  if (i.kind === "commitment") {
    parts.push(`owed by ${i.owedBy ?? "unknown"} to ${i.owedTo ?? "unknown"}`);
    if (i.dueText) parts.push(`due ${i.dueText}`);
  } else {
    if (i.cadence) parts.push(i.cadence);
    if (i.approver) parts.push(`approved by ${i.approver}`);
  }
  const quotes = i.sources.slice(0, 2).map((s) => `     Stated in ${KIND[s.sourceType]}, ${s.ts ? formatIst(s.ts) : "undated"}: "${s.quote}"`);
  return [`  ${label}: ${parts.join(" | ")}`, ...quotes];
}

/** The user turn for one batch, and the pair each reference stands for. */
export function buildMatchPrompt(pairs: readonly MatchPair[], items: ReadonlyMap<string, MatchItem>): { user: string; refs: Map<string, MatchPair> } {
  const refs = new Map<string, MatchPair>();
  const blocks: string[] = [];
  pairs.forEach((p, n) => {
    const a = items.get(p.a);
    const b = items.get(p.b);
    if (!a || !b) return;
    const ref = `p${n + 1}`;
    refs.set(ref, p);
    blocks.push([`Pair ${ref}`, ...itemLines("A", a), ...itemLines("B", b)].join("\n"));
  });
  return { user: `Pairs (times in IST):\n\n${blocks.join("\n\n")}`, refs };
}

export type MatchDropReason = "unknown_pair" | "duplicate" | "no_verdict";

/** Keep one verdict per known pair. Pairs the model skipped are left unlinked and counted. */
export function postProcessMatches(output: MatchOutput, refs: ReadonlyMap<string, MatchPair>): { same: MatchPair[]; possible: MatchPair[]; dropped: Partial<Record<MatchDropReason, number>> } {
  const dropped: Partial<Record<MatchDropReason, number>> = {};
  const drop = (r: MatchDropReason, n = 1) => (dropped[r] = (dropped[r] ?? 0) + n);
  const seen = new Set<string>();
  const same: MatchPair[] = [];
  const possible: MatchPair[] = [];
  for (const v of output.verdicts) {
    const ref = v.pair.trim().replace(/^\[|\]$/g, "").toLowerCase();
    const pair = refs.get(ref);
    if (!pair) {
      drop("unknown_pair");
      continue;
    }
    if (seen.has(ref)) {
      drop("duplicate");
      continue;
    }
    seen.add(ref);
    if (v.verdict === "same") same.push(pair);
    else if (v.verdict === "unsure") possible.push(pair);
  }
  const missing = [...refs.keys()].filter((r) => !seen.has(r)).length;
  if (missing) drop("no_verdict", missing);
  return { same, possible, dropped };
}
