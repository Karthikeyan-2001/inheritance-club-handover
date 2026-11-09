// Deterministic retrieval of the messages related to one obligation, for the follow-up check.
// Messages are scored by the rare words they share with the obligation (inverse document
// frequency), with a boost for the same Trello card or meeting. Code picks what the model
// sees; the model never searches.

import type { PipelineEvent } from "./extract.ts";
import { contentTokens } from "./text.ts";

export type Idf = { weight(token: string): number; tokensOf(eventId: string): Set<string> };

/** Token weights over a set of events: rarer words weigh more. */
export function buildIdf(events: readonly PipelineEvent[]): Idf {
  const df = new Map<string, number>();
  const tokens = new Map<string, Set<string>>();
  for (const e of events) {
    const t = contentTokens(e.text);
    tokens.set(e.id, t);
    for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = Math.max(events.length, 1);
  return {
    weight: (w) => Math.log((n + 1) / ((df.get(w) ?? 0) + 0.5)),
    tokensOf: (id) => tokens.get(id) ?? new Set(),
  };
}

export type RelatedTarget = {
  /** Description, people and quotes of the obligation. */
  text: string;
  /** The messages the obligation is built from (always included, marked as the source). */
  sourceEventIds: readonly string[];
};

export const MAX_RELATED = 24;
const SAME_THREAD_BONUS = 3;
// Trello threads are cards (one task each); chat threads are whole days, so they get less.
const CHAT_THREAD_BONUS = 0.5;

/**
 * Up to `max` messages related to the target, oldest first, plus its source messages.
 * A message qualifies if it shares at least one content word with the target or sits on
 * the same Trello card as a source message.
 */
export function relatedEvents(target: RelatedTarget, events: readonly PipelineEvent[], idf: Idf, max = MAX_RELATED): PipelineEvent[] {
  const sources = new Set(target.sourceEventIds);
  const sourceEvents = events.filter((e) => sources.has(e.id));
  const threads = new Map(sourceEvents.filter((e) => e.threadId).map((e) => [`${e.sourceType}|${e.threadId}`, e.sourceType]));
  const want = contentTokens(`${target.text} ${sourceEvents.map((e) => e.text).join(" ")}`);

  const scored: { e: PipelineEvent; score: number }[] = [];
  for (const e of events) {
    if (sources.has(e.id)) continue;
    let score = 0;
    for (const w of idf.tokensOf(e.id)) if (want.has(w)) score += idf.weight(w);
    if (score <= 0 && !(e.sourceType === "trello" && threads.has(`${e.sourceType}|${e.threadId}`))) continue;
    const type = threads.get(`${e.sourceType}|${e.threadId}`);
    if (type) score += type === "whatsapp" ? CHAT_THREAD_BONUS : SAME_THREAD_BONUS;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || timeOf(a.e) - timeOf(b.e));
  const picked = [...sourceEvents, ...scored.slice(0, max).map((s) => s.e)];
  return picked.sort(byTime);
}

/** Milliseconds since the epoch; undated events sort last. */
export const timeOf = (e: Pick<PipelineEvent, "ts">): number => (e.ts ? Date.parse(e.ts) : Number.POSITIVE_INFINITY);
export const byTime = (a: PipelineEvent, b: PipelineEvent): number => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id);
