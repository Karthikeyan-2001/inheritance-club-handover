// The trust rule (CLAUDE.md, non-negotiable 2). The database applies it in app.trust_rule()
// (migration 0011) every time an obligation, its evidence or its links change; this mirror is
// for the eval and unit tests. Keep the two in sync.
//
// Trust says how well the records back what the ledger states about an item. Only verified
// evidence counts: the item's own, plus evidence borrowed from items linked as the same
// obligation, and only from those at the same or a less restricted level (canBorrow).

import { levelRank, type AccessLevel } from "../access.ts";

export type TrustState = "corroborated" | "sourced" | "inferred" | "contradicted" | "gap";

export type TrustEvidence = {
  relation: "supports" | "fulfils" | "contradicts" | "past_instance";
  inferred: boolean;
  verified: boolean;
  eventId: string;
  /** The file the message came from. */
  sourceId: string;
  author: string | null;
};

const person = (author: string | null): string | null => {
  const a = author?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return a ? a : null;
};

/**
 * Two messages back an item independently when they are different messages and come from
 * different files, or from different named people. One person repeating themselves in one
 * chat is still one record; an unknown author never counts as a second person.
 */
export function independent(a: Pick<TrustEvidence, "eventId" | "sourceId" | "author">, b: Pick<TrustEvidence, "eventId" | "sourceId" | "author">): boolean {
  if (a.eventId === b.eventId) return false;
  if (a.sourceId !== b.sourceId) return true;
  const pa = person(a.author);
  const pb = person(b.author);
  return pa !== null && pb !== null && pa !== pb;
}

/**
 * No verified evidence: gap. Says done and says not done: contradicted. Done only by
 * inference: inferred (never shown as fact). Two independent records that agree:
 * corroborated. Otherwise: sourced.
 */
export function trustState(evidence: readonly TrustEvidence[]): TrustState {
  const v = evidence.filter((e) => e.verified);
  if (v.length === 0) return "gap";
  const done = v.some((e) => e.relation === "fulfils");
  const direct = v.some((e) => e.relation === "fulfils" && !e.inferred);
  const notDone = v.some((e) => e.relation === "contradicts");
  if (done && notDone) return "contradicted";
  if (done && !direct) return "inferred";
  const firm = v.filter((e) => !e.inferred);
  for (let i = 0; i < firm.length; i++) {
    for (let j = i + 1; j < firm.length; j++) if (independent(firm[i], firm[j])) return "corroborated";
  }
  return "sourced";
}

export type Visibility = { level: AccessLevel; privateUploaders: readonly string[] };

/**
 * May an item use the evidence of a linked item? Only if everyone who can read the item can
 * also read the linked one: a less restricted level, or the same level (and, for private
 * items, only files from the same uploaders). Otherwise a restricted record could change
 * what a less restricted reader is told.
 */
export function canBorrow(to: Visibility, from: Visibility): boolean {
  const a = levelRank(from.level);
  const b = levelRank(to.level);
  if (a < b) return true;
  if (a > b) return false;
  if (to.level !== "private") return true;
  return from.privateUploaders.length > 0 && from.privateUploaders.every((u) => to.privateUploaders.includes(u));
}
