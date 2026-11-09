// Pure view logic for the ledger: grouping linked records into one card, and finding gaps.
// Inputs are rows RLS already filtered, so nothing here can reveal an unreadable item.

import type { TrustState } from "./pipeline/trust.ts";

export type LinkVerdict = { a: string; b: string; verdict: "same" | "possible" };

/** "lab inventory list" -> "Lab inventory list". */
export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export type CardGroup = {
  /** The item the card is about (the earliest of the group). */
  primary: string;
  /** Items recorded as the same thing, shown inside the primary's card. */
  also: string[];
  /** Items that might be the same: a quiet note, never merged and never used as evidence. */
  possible: string[];
  /**
   * `same` links from a member of this card to an item shown on another card (links do not
   * chain, so A-B and B-C leave C on its own card). Shown as a note so no link is lost.
   */
  elsewhere: { from: string; to: string }[];
};

/**
 * One card per item with its `same`-linked records folded in. Grouping uses direct links only
 * (links are not transitive, and neither is trust borrowing), so A-B and B-C make cards for A
 * (with B) and C, not one card claiming A and C are the same.
 * `order` lists the item ids oldest first.
 */
export function groupLinked(order: readonly string[], links: readonly LinkVerdict[]): CardGroup[] {
  const known = new Set(order);
  const same = new Map<string, Set<string>>();
  const possible = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, from: string, to: string) => m.set(from, (m.get(from) ?? new Set()).add(to));
  for (const l of links) {
    if (!known.has(l.a) || !known.has(l.b) || l.a === l.b) continue;
    const m = l.verdict === "same" ? same : possible;
    put(m, l.a, l.b);
    put(m, l.b, l.a);
  }
  const taken = new Set<string>();
  const out: CardGroup[] = [];
  for (const id of order) {
    if (taken.has(id)) continue;
    taken.add(id);
    const also = order.filter((o) => same.get(id)?.has(o) && !taken.has(o));
    for (const o of also) taken.add(o);
    const members = new Set([id, ...also]);
    const maybe = order.filter((o) => !members.has(o) && [...members].some((m) => possible.get(m)?.has(o)));
    out.push({ primary: id, also, possible: maybe, elsewhere: [] });
  }
  const groupOf = new Map<string, CardGroup>();
  for (const g of out) for (const m of [g.primary, ...g.also]) groupOf.set(m, g);
  for (const g of out) {
    for (const m of [g.primary, ...g.also]) {
      for (const o of order) if (same.get(m)?.has(o) && groupOf.get(o) !== g) g.elsewhere.push({ from: m, to: o });
    }
  }
  return out;
}

export type GapInput = {
  id: string;
  kind: "commitment" | "recurring";
  description: string;
  status: "open" | "fulfilled" | "likely_fulfilled" | "no_evidence" | "contradicted";
  trust_state: TrustState;
  next_due: string | null;
  fulfilment_checked_at: string | null;
};

export type Gap = {
  id: string;
  kind: GapInput["kind"];
  description: string;
  what: string;
  closeWith: string;
  /** Records linked as the same item, so the Gaps tab can say why their evidence does not count here. */
  twins: { id: string; description: string; trust_state: TrustState }[];
};

/**
 * What is missing for each item, and what would fill it in. An item may appear for more than one
 * reason. A gap is reported per record even when a linked record has evidence: the trust rule
 * already borrows evidence wherever it may (same or less restricted level), so a record that is
 * still a gap cannot use its twin's evidence. The twin is listed so the tab can say so.
 */
export function findGaps(items: readonly GapInput[], links: readonly LinkVerdict[] = []): Gap[] {
  const byId = new Map(items.map((o) => [o.id, o]));
  const twinsOf = (id: string) =>
    links
      .filter((l) => l.verdict === "same" && (l.a === id || l.b === id))
      .map((l) => byId.get(l.a === id ? l.b : l.a))
      .filter((o): o is GapInput => Boolean(o) && o!.id !== id)
      .map((o) => ({ id: o.id, description: o.description, trust_state: o.trust_state }));
  const gaps: Gap[] = [];
  for (const o of items) {
    const base = { id: o.id, kind: o.kind, description: o.description, twins: twinsOf(o.id) };
    if (o.trust_state === "gap") {
      gaps.push({ ...base, what: "No verified evidence is kept for this item.", closeWith: "Import the record that shows it (a message, minutes or Trello card), then build the ledger again." });
    }
    if (o.kind === "commitment" && o.status === "no_evidence") {
      gaps.push({ ...base, what: "No evidence kept of what happened after the promise.", closeWith: "Import the later messages that show it was done or not, or have the owner confirm it was never done." });
    }
    if (o.kind === "commitment" && o.status === "open" && !o.fulfilment_checked_at) {
      gaps.push({ ...base, what: "Not yet checked for follow-up.", closeWith: "Build the ledger so the follow-up check runs." });
    }
    if (o.kind === "recurring" && !o.next_due) {
      gaps.push({ ...base, what: "No next date can be derived from the records.", closeWith: "Import minutes or messages that give the date of a past run or the next one." });
    }
  }
  return gaps;
}
