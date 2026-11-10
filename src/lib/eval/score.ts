// Score a pipeline run (run-memory.ts) against a scenario's ground truth. Pure: no model, no
// database. Used by `pnpm eval:pipeline` and by the tests that run the offline fake over every
// scenario. Matching is by message and quote: a planted commitment is found when an item cites
// its promise message with an overlapping quote; a duty when an item quotes any of its planted
// sentences. (One minutes entry can hold several items, so the message alone is not enough.)

import { levelRank, type AccessLevel } from "../access.ts";
import type { MemoryResult } from "../pipeline/run-memory.ts";
import { normaliseForQuote } from "../pipeline/verify.ts";
import type { Truth } from "../synth/truth.ts";
import { eventFor, type Scenario } from "./scenario.ts";

export type CommitmentRow = {
  id: string;
  found: boolean;
  itemId: string | null;
  expectedStatus: string;
  status: string | null;
  expectedTrust: string | null;
  trust: string | null;
  expectedAccess: AccessLevel | null;
  level: AccessLevel | null;
  evidence: { relation: string; text: string; found: boolean }[];
  extraEvidence: { relation: string; quote: string; inferred: boolean }[];
};
export type DutyRow = {
  id: string;
  found: boolean;
  itemId: string | null;
  description: string | null;
  expectedApprover: string | null;
  approver: string | null;
  approverOk: boolean | null;
  expectedTrust: string;
  trust: string | null;
  level: AccessLevel | null;
  nextDue: string | null;
};
export type ExtraRow = { itemId: string; kind: "decoy" | "restatement" | "unplanned"; quote: string; level: AccessLevel; status: string };
export type Leak = { itemId: string; level: AccessLevel; field: string; restricted: { level: AccessLevel; text: string } };
export type LinkRow = { a: string; b: string; verdict: string; method: string; wrong: boolean; label: string };

export type Scorecard = {
  scenario: string;
  commitments: {
    total: number; found: number; statusOk: number; trustOk: number; trustScored: number; accessOk: number; accessScored: number;
    evidenceFound: number; evidenceTotal: number; rows: CommitmentRow[];
  };
  extras: { decoys: number; restatements: number; unplanned: number; rows: ExtraRow[] };
  /** Kept commitments that are planted items or restatements of them, out of all kept. */
  precision: number;
  contradictions: { total: number; detected: number; rows: { id: string; commitment: string; detected: boolean }[] };
  duties: { total: number; found: number; approverOk: number; approverScored: number; trustOk: number; copies: number; unplanned: number; rows: DutyRow[]; extraRows: string[] };
  links: { same: number; possible: number; wrong: number; rows: LinkRow[] };
  /** Restricted text stored on an item (or note) readable at a lower level. Must be empty. */
  leaks: Leak[];
  dropped: Record<string, number>;
  calls: number;
  usage: { inputTokens: number; outputTokens: number };
};

const norm = normaliseForQuote;
/** One quote contains the other, after the verifier's normalisation. */
export const overlaps = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};
const sameApprover = (want: string, got: string | null) => {
  if (!got) return false;
  const a = norm(want);
  const b = norm(got);
  return a.includes(b) || b.includes(a);
};

export function scoreRun(res: MemoryResult, scenario: Pick<Scenario, "name" | "truth" | "events">): Scorecard {
  const { truth, events } = scenario;
  const idOf = (q: { file: string; text: string }) => eventFor(events, q)?.id;
  /** A stored quote (on a message) is the planted quote `q`. */
  const isQuote = (eventId: string, quote: string, q: { file: string; text: string }) => eventId === idOf(q) && overlaps(quote, q.text);

  // Commitments.
  const truthOfItem = new Map<string, string>();
  const rows: CommitmentRow[] = truth.commitments.map((c) => {
    const got = res.commitments.find((k) => [c.quote, ...c.alternates].some((q) => isQuote(k.candidate.event.id, k.candidate.quote, q)));
    if (got) truthOfItem.set(got.id, c.id);
    const hit = (k: { relation: string; event: { id: string }; quote: string }, e: (typeof c.evidence)[number]) => k.relation === e.relation && isQuote(k.event.id, k.quote, e);
    const evidence = c.evidence.map((e) => ({ relation: e.relation, text: e.text, found: Boolean(got?.evidence.some((k) => hit(k, e))) }));
    const extraEvidence = (got?.evidence ?? [])
      .filter((k) => !c.evidence.some((e) => hit(k, e)))
      .map((k) => ({ relation: k.relation, quote: k.quote, inferred: k.inferred }));
    return {
      id: c.id, found: Boolean(got), itemId: got?.id ?? null, expectedStatus: c.expectedStatus, status: got?.status ?? null,
      expectedTrust: c.expectedTrust, trust: got?.trust ?? null, expectedAccess: c.expectedAccess ?? null, level: got?.level ?? null, evidence, extraEvidence,
    };
  });
  const found = rows.filter((r) => r.found);

  // Duties: the copy at the least restricted level its quotes allow (a finance copy may exist too).
  const quotesDuty = (d: MemoryResult["duties"][number], r: Truth["recurring"][number]) => d.duty.quotes.some((q) => r.quotes.some((t) => isQuote(q.event.id, q.quote, t)));
  const matchedDuties = new Set<string>();
  const dutyRows: DutyRow[] = truth.recurring.map((r) => {
    const want = r.expectedAccess ?? r.quotes.map((q) => truth.files[q.file]?.accessLevel ?? "everyone").reduce((a, b) => (levelRank(b) < levelRank(a) ? b : a));
    const cites = res.duties.filter((d) => quotesDuty(d, r) && !matchedDuties.has(d.id));
    const d = cites.find((x) => x.level === want) ?? cites[0];
    if (d) matchedDuties.add(d.id);
    return {
      id: r.id, found: Boolean(d), itemId: d?.id ?? null, description: d?.duty.description ?? null,
      expectedApprover: r.approver, approver: d?.duty.approver ?? null, approverOk: r.approver === null ? null : d ? sameApprover(r.approver, d.duty.approver) : false,
      expectedTrust: r.expectedTrust, trust: d?.trust ?? null, level: d?.level ?? null, nextDue: d?.schedule.nextDue ?? null,
    };
  });
  const extraDuties = res.duties.filter((d) => !matchedDuties.has(d.id));
  const copies = extraDuties.filter((d) => truth.recurring.some((r) => quotesDuty(d, r)));
  const dutyTruthOf = (itemId: string) => dutyRows.find((r) => r.itemId === itemId)?.id;

  // Links.
  const linkedTo = (id: string) => res.links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
  const label = (id: string) => {
    const c = res.commitments.find((x) => x.id === id);
    if (c) return `${truthOfItem.get(id) ?? "extra"} "${c.candidate.deliverable}" (${c.level})`;
    const d = res.duties.find((x) => x.id === id);
    return `${dutyTruthOf(id) ?? "extra"} duty "${d?.duty.description}" (${d?.level})`;
  };
  const linkRows: LinkRow[] = res.links.map((l) => {
    const ta = truthOfItem.get(l.a) ?? dutyTruthOf(l.a);
    const tb = truthOfItem.get(l.b) ?? dutyTruthOf(l.b);
    return { ...l, wrong: Boolean(ta && tb && ta !== tb && l.verdict === "same"), label: `${label(l.a)}  <->  ${label(l.b)}` };
  });

  // Extra commitments.
  const extraRows: ExtraRow[] = res.commitments
    .filter((k) => !truthOfItem.has(k.id))
    .map((k) => ({
      itemId: k.id,
      kind: truth.decoys.some((d) => isQuote(k.candidate.event.id, k.candidate.quote, d)) ? "decoy" : linkedTo(k.id).some((o) => truthOfItem.has(o)) ? "restatement" : "unplanned",
      quote: k.candidate.quote, level: k.level, status: k.status,
    }));
  const restatements = extraRows.filter((x) => x.kind === "restatement").length;

  // Contradictions: the planted commitment ends up contradicted.
  const contradictionRows = truth.contradictions.map((x) => ({ id: x.id, commitment: x.commitment, detected: rows.find((r) => r.id === x.commitment)?.status === "contradicted" }));

  return {
    scenario: scenario.name,
    commitments: {
      total: rows.length, found: found.length,
      statusOk: found.filter((r) => r.status === r.expectedStatus).length,
      trustOk: found.filter((r) => r.expectedTrust !== null && r.trust === r.expectedTrust).length,
      trustScored: found.filter((r) => r.expectedTrust !== null).length,
      accessOk: found.filter((r) => r.expectedAccess !== null && r.level === r.expectedAccess).length,
      accessScored: found.filter((r) => r.expectedAccess !== null).length,
      evidenceFound: rows.reduce((n, r) => n + r.evidence.filter((e) => e.found).length, 0),
      evidenceTotal: rows.reduce((n, r) => n + r.evidence.length, 0),
      rows,
    },
    extras: { decoys: extraRows.filter((x) => x.kind === "decoy").length, restatements, unplanned: extraRows.filter((x) => x.kind === "unplanned").length, rows: extraRows },
    precision: res.commitments.length ? (found.length + restatements) / res.commitments.length : 1,
    contradictions: { total: contradictionRows.length, detected: contradictionRows.filter((x) => x.detected).length, rows: contradictionRows },
    duties: {
      total: dutyRows.length, found: dutyRows.filter((r) => r.found).length,
      approverOk: dutyRows.filter((r) => r.approverOk === true).length, approverScored: dutyRows.filter((r) => r.approverOk !== null).length,
      trustOk: dutyRows.filter((r) => r.trust === r.expectedTrust).length,
      copies: copies.length, unplanned: extraDuties.length - copies.length, rows: dutyRows,
      extraRows: extraDuties.map((d) => `${copies.includes(d) ? "copy" : "unplanned"}: "${d.duty.description}" (${d.duty.period}, level ${d.level}, ${d.duty.quotes.length} quote(s), trust ${d.trust})`),
    },
    links: { same: res.links.filter((l) => l.verdict === "same").length, possible: res.links.filter((l) => l.verdict === "possible").length, wrong: linkRows.filter((l) => l.wrong).length, rows: linkRows },
    leaks: findLeaks(res, truth),
    dropped: res.dropped,
    calls: res.calls,
    usage: res.usage,
  };
}

/**
 * Restricted text in anything the pipeline would store at a lower level: an item's description,
 * people, dates, cadence, approval and quotes at the item's level, and each context note at its
 * own message's level. The item's level already follows its cited messages (provenance), so a
 * leak here means model-written text carried a restricted fact into a more open row.
 */
export function findLeaks(res: MemoryResult, truth: Truth): Leak[] {
  const leaks: Leak[] = [];
  const check = (itemId: string, level: AccessLevel, field: string, text: string | null | undefined) => {
    if (!text) return;
    for (const r of truth.restricted) if (levelRank(r.level) > levelRank(level) && text.includes(r.text)) leaks.push({ itemId, level, field, restricted: r });
  };
  const levelOf = (e: { accessLevel?: AccessLevel }) => e.accessLevel ?? "everyone";
  for (const c of res.commitments) {
    const k = c.candidate;
    for (const [field, text] of [["deliverable", k.deliverable], ["owed by", k.owedBy], ["owed to", k.owedTo], ["due", k.dueText], ["quote", k.quote]] as const) check(c.id, c.level, field, text);
    for (const e of c.evidence) check(c.id, c.level, "evidence quote", e.quote);
    for (const x of c.context) {
      check(c.id, levelOf(x.event), "context note", x.note);
      check(c.id, levelOf(x.event), "context quote", x.quote);
    }
  }
  for (const d of res.duties) {
    const k = d.duty;
    for (const [field, text] of [["description", k.description], ["cadence", k.cadence], ["approval", k.approval], ["approver", k.approver], ["lead time", k.leadTime], ["when", k.whenWords], ["owner", k.owedBy]] as const) check(d.id, d.level, field, text);
    for (const q of k.quotes) check(d.id, d.level, "quote", q.quote);
    for (const x of d.context) {
      check(d.id, levelOf(x.event), "context note", x.note);
      check(d.id, levelOf(x.event), "context quote", x.quote);
    }
  }
  return leaks;
}

const pct = (n: number, d: number) => (d ? `${n}/${d}` : "-");

/** The scorecard as the eval script prints it. */
export function formatScorecard(card: Scorecard): string {
  const out: string[] = [];
  const c = card.commitments;
  out.push(`Scenario: ${card.scenario}`, "", "Commitments and their status");
  for (const r of c.rows) {
    const wrongS = r.found && r.status !== r.expectedStatus ? "   <-- wrong" : "";
    const wrongT = r.found && r.expectedTrust !== null && r.trust !== r.expectedTrust ? "   <-- wrong" : "";
    const access = r.expectedAccess ? ` | level: expected ${r.expectedAccess}, got ${r.level ?? "-"}${r.found && r.level !== r.expectedAccess ? "   <-- wrong" : ""}` : "";
    out.push(`${r.found ? "FOUND " : "MISSED"} ${r.id}: expected ${r.expectedStatus}, got ${r.status ?? "-"}${wrongS} | trust: expected ${r.expectedTrust ?? "(not scored)"}, got ${r.trust ?? "-"}${wrongT}${access}`);
    for (const e of r.evidence) out.push(`         ${e.found ? "has " : "LACKS"} ${e.relation}: ${e.text}`);
    for (const e of r.extraEvidence) out.push(`         extra ${e.relation}${e.inferred ? " (inferred)" : ""}: "${e.quote}"`);
  }
  for (const x of card.extras.rows) out.push(`  extra commitment (${x.kind.toUpperCase()}): "${x.quote}" -> ${x.status}, level ${x.level}`);
  out.push("", "Recurring duties");
  for (const d of card.duties.rows) {
    out.push(
      `${d.found ? "FOUND " : "MISSED"} ${d.id}: ${d.found ? `"${d.description}" | approver: expected ${d.expectedApprover ?? "none"}, got ${d.approver ?? "-"}${d.approverOk === false ? "   <-- approver" : ""} | next due ${d.nextDue ?? "-"} | level ${d.level} | trust: expected ${d.expectedTrust}, got ${d.trust}${d.trust !== d.expectedTrust ? "   <-- wrong" : ""}` : ""}`,
    );
  }
  for (const x of card.duties.extraRows) out.push(`  extra duty, ${x}`);
  out.push("", "Links between items");
  for (const l of card.links.rows) out.push(`  ${l.verdict} (${l.method}): ${l.label}${l.wrong ? "   <-- WRONG" : ""}`);
  if (card.links.rows.length === 0) out.push("  none");
  out.push("", "Leaks (restricted text stored at a lower level)");
  for (const l of card.leaks) out.push(`  LEAK ${l.itemId} (${l.level}) ${l.field}: "${l.restricted.text}" belongs to ${l.restricted.level}`);
  if (card.leaks.length === 0) out.push("  none");
  out.push("", summary(card));
  return out.join("\n");
}

/** The headline numbers, one fact per line. */
export function summary(card: Scorecard): string {
  const c = card.commitments;
  const d = card.duties;
  return [
    `Commitments found: ${pct(c.found, c.total)}. Precision: ${(card.precision * 100).toFixed(0)}% (decoys kept ${card.extras.decoys}, restatements ${card.extras.restatements}, unplanned ${card.extras.unplanned}).`,
    `Status correct: ${pct(c.statusOk, c.found)} found. Trust correct: ${pct(c.trustOk, c.trustScored)} scored. Level correct: ${pct(c.accessOk, c.accessScored)}. Follow-up evidence found: ${pct(c.evidenceFound, c.evidenceTotal)}.`,
    `Contradictions detected: ${pct(card.contradictions.detected, card.contradictions.total)}.`,
    `Recurring duties found: ${pct(d.found, d.total)}, approver right: ${pct(d.approverOk, d.approverScored)}, trust right: ${pct(d.trustOk, d.total)}. Extra duties: ${d.copies} copies, ${d.unplanned} unplanned.`,
    `Links: ${card.links.same} same, ${card.links.possible} possible, ${card.links.wrong} wrong. Leaks: ${card.leaks.length}.`,
    `Left out by checks: ${JSON.stringify(card.dropped)}`,
  ].join("\n");
}
