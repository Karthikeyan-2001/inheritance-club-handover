import { FIELD_LABELS } from "./fields.ts";

// Compares two lists of items as a role can read them: the pending draft against the last
// version, or one version against the one before. Pure: it sees only rows already filtered by
// row-level security, so it can never show a role something it cannot read.

export type ItemEvidence = { event_id: string; quote: string; relation: string; verified?: boolean; inferred?: boolean };
export type ItemConflict = { id: string; summary?: string; ruling: string | null; reason: string | null };
export type Note = { id: string; kind: string; text: string };

/** The jsonb held in version_items.item. Format 1 (before Phase 8) has no format key, links or conflicts. */
export type VersionItem = {
  format?: number;
  obligation: Record<string, unknown>;
  evidence: ItemEvidence[];
  linked_same?: string[];
  conflicts?: ItemConflict[];
};

export type DiffRow = { obligation_id: string; item: VersionItem; notes?: Note[] };

// What every format records (mirrors app.item_core in migration 0013). Newer fields are compared
// only between two format-2 items, so an old version is not all reported as changed.
const CORE_FIELDS = ["description", "owed_by", "owed_to", "due_text", "due_date", "next_due", "approval_required", "approver", "status", "trust_state", "access_level"];
const NEWER_FIELDS = ["cadence", "lead_time", "start_by", "period", "review_state"];

export type FieldChange = { field: string; label: string; before: string | null; after: string | null };

export type ItemChange = {
  id: string;
  description: string;
  fields: FieldChange[];
  quotesAdded: { quote: string; relation: string; eventId: string }[];
  quotesRemoved: { quote: string; relation: string }[];
  linksAdded: string[];
  linksRemoved: string[];
  rulings: { summary: string | null; before: string | null; after: string | null }[];
  notesAdded: Note[];
  notesRemoved: Note[];
};

export type VersionDiff = {
  added: { id: string; description: string }[];
  removed: { id: string; description: string }[];
  changed: ItemChange[];
  unchanged: number;
};

const FIELD_NAMES: Record<string, string> = {
  ...FIELD_LABELS,
  status: "Status",
  trust_state: "Trust",
  access_level: "Access level",
  period: "Repeats",
  review_state: "Review",
};

const text = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));
const describe = (r: DiffRow) => text(r.item.obligation.description) ?? "Untitled item";
const isNew = (r: DiffRow) => r.item.format === 2;
const evKey = (e: ItemEvidence) => `${e.event_id}|${e.relation}|${e.quote}`;

function diffItem(prev: DiffRow, next: DiffRow): ItemChange | null {
  const both2 = isNew(prev) && isNew(next);
  const fields: FieldChange[] = [];
  for (const field of both2 ? [...CORE_FIELDS, ...NEWER_FIELDS] : CORE_FIELDS) {
    const before = text(prev.item.obligation[field]);
    const after = text(next.item.obligation[field]);
    if (before !== after) fields.push({ field, label: FIELD_NAMES[field] ?? field, before, after });
  }

  const before = new Map(prev.item.evidence.map((e) => [evKey(e), e]));
  const after = new Map(next.item.evidence.map((e) => [evKey(e), e]));
  const quotesAdded = [...after].filter(([k]) => !before.has(k)).map(([, e]) => ({ quote: e.quote, relation: e.relation, eventId: e.event_id }));
  const quotesRemoved = [...before].filter(([k]) => !after.has(k)).map(([, e]) => ({ quote: e.quote, relation: e.relation }));

  let linksAdded: string[] = [];
  let linksRemoved: string[] = [];
  const rulings: ItemChange["rulings"] = [];
  let notesAdded: Note[] = [];
  let notesRemoved: Note[] = [];
  if (both2) {
    const a = new Set(prev.item.linked_same ?? []);
    const b = new Set(next.item.linked_same ?? []);
    linksAdded = [...b].filter((x) => !a.has(x));
    linksRemoved = [...a].filter((x) => !b.has(x));

    const prevRuling = new Map((prev.item.conflicts ?? []).map((c) => [c.id, c]));
    for (const c of next.item.conflicts ?? []) {
      const was = prevRuling.get(c.id);
      if ((was?.ruling ?? null) !== (c.ruling ?? null)) rulings.push({ summary: c.summary ?? null, before: was?.ruling ?? null, after: c.ruling ?? null });
    }

    if (prev.notes && next.notes) {
      const pn = new Map(prev.notes.map((n) => [n.id, n]));
      const nn = new Map(next.notes.map((n) => [n.id, n]));
      notesAdded = [...nn].filter(([k]) => !pn.has(k)).map(([, n]) => n);
      notesRemoved = [...pn].filter(([k]) => !nn.has(k)).map(([, n]) => n);
    }
  }

  const empty = !fields.length && !quotesAdded.length && !quotesRemoved.length && !linksAdded.length && !linksRemoved.length && !rulings.length && !notesAdded.length && !notesRemoved.length;
  if (empty) return null;
  return { id: next.obligation_id, description: describe(next), fields, quotesAdded, quotesRemoved, linksAdded, linksRemoved, rulings, notesAdded, notesRemoved };
}

/**
 * Items new in `next`, items gone from it, and items changed, with what changed. With no
 * `prev` (the first version) every item is new.
 */
export function diffVersions(prev: readonly DiffRow[] | null, next: readonly DiffRow[]): VersionDiff {
  const before = new Map((prev ?? []).map((r) => [r.obligation_id, r]));
  const after = new Map(next.map((r) => [r.obligation_id, r]));
  const added = next.filter((r) => !before.has(r.obligation_id)).map((r) => ({ id: r.obligation_id, description: describe(r) }));
  const removed = (prev ?? []).filter((r) => !after.has(r.obligation_id)).map((r) => ({ id: r.obligation_id, description: describe(r) }));
  const changed: ItemChange[] = [];
  let unchanged = 0;
  for (const r of next) {
    const was = before.get(r.obligation_id);
    if (!was) continue;
    const c = diffItem(was, r);
    if (c) changed.push(c);
    else unchanged += 1;
  }
  return { added, removed, changed, unchanged };
}

export function isEmptyDiff(d: VersionDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length;
}
