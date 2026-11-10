// Pure helpers for /handover. They see only rows already filtered by row-level security
// (version_items as the viewer's role may read them), so nothing here can reveal more.

export type HandoverItem = {
  id: string;
  kind: "commitment" | "recurring";
  description: string;
  owedBy: string | null;
  owedTo: string | null;
  dueText: string | null;
  dueDate: string | null;
  nextDue: string | null;
  startBy: string | null;
  cadence: string | null;
  approval: string | null;
  approver: string | null;
  status: string | null;
  trust: string | null;
};

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Reads one version_items.item jsonb. Returns null for a shape that is not an obligation. */
export function toHandoverItem(id: string, item: { obligation?: Record<string, unknown> } | null | undefined): HandoverItem | null {
  const o = item?.obligation;
  if (!o) return null;
  return {
    id,
    kind: o.kind === "recurring" ? "recurring" : "commitment",
    description: s(o.description) ?? "Untitled item",
    owedBy: s(o.owed_by),
    owedTo: s(o.owed_to),
    dueText: s(o.due_text),
    dueDate: s(o.due_date),
    nextDue: s(o.next_due),
    startBy: s(o.start_by),
    cadence: s(o.cadence),
    approval: s(o.approval_required),
    approver: s(o.approver),
    status: s(o.status),
    trust: s(o.trust_state),
  };
}

export type WaitingGroup = { person: string; items: HandoverItem[] };

const UNSTATED = "Not stated who it is owed to";
const closed = (i: HandoverItem) => i.status === "fulfilled";

/**
 * Open commitments grouped by who is waiting. Fulfilled ones are left out. Within a group the
 * soonest dated item comes first; undated ones last. Groups are in name order, with the
 * "not stated" group at the end, so a gap in the records is visible rather than hidden.
 */
export function peopleWaiting(items: readonly HandoverItem[]): WaitingGroup[] {
  const groups = new Map<string, HandoverItem[]>();
  for (const i of items) {
    if (i.kind !== "commitment" || closed(i)) continue;
    const key = i.owedTo ?? UNSTATED;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const when = (i: HandoverItem) => i.dueDate ?? "9999-12-31";
  return [...groups]
    .map(([person, list]) => ({ person, items: [...list].sort((a, b) => when(a).localeCompare(when(b)) || a.description.localeCompare(b.description)) }))
    .sort((a, b) => (a.person === UNSTATED ? 1 : b.person === UNSTATED ? -1 : a.person.localeCompare(b.person)));
}

export type DutyTiming = "overdue" | "start_now" | "upcoming" | "undated";
export type CalendarEntry = { item: HandoverItem; timing: DutyTiming; sortKey: string; month: string };

/** `today` is an IST calendar day, YYYY-MM-DD. */
export function dutyTiming(item: HandoverItem, today: string): DutyTiming {
  if (!item.nextDue) return "undated";
  if (item.nextDue < today) return "overdue";
  if (item.startBy && item.startBy <= today) return "start_now";
  return "upcoming";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(day);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : "No date recorded";
}

/** Recurring duties by their next due date, undated ones last. */
export function dutyCalendar(items: readonly HandoverItem[], today: string): CalendarEntry[] {
  return items
    .filter((i) => i.kind === "recurring")
    .map((item) => ({ item, timing: dutyTiming(item, today), sortKey: item.nextDue ?? "9999-12-31", month: item.nextDue ? monthLabel(item.nextDue) : "No date recorded" }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.item.description.localeCompare(b.item.description));
}

export type AckAction = "accept" | "question" | "decline";
export type AckRow = { obligation_id: string; user_id: string; action: AckAction; note: string | null; created_at: string };

/** Latest acknowledgement per item for one user (the view already keeps the latest; this is the safety net). */
export function latestAckByItem(rows: readonly AckRow[], userId: string): Map<string, AckRow> {
  const out = new Map<string, AckRow>();
  for (const r of rows) {
    if (r.user_id !== userId) continue;
    const prev = out.get(r.obligation_id);
    if (!prev || r.created_at >= prev.created_at) out.set(r.obligation_id, r);
  }
  return out;
}

export const ACK_LABELS: Record<AckAction, string> = { accept: "Accepted", question: "Question raised", decline: "Declined" };

export function ackSummary(itemIds: readonly string[], acks: ReadonlyMap<string, AckRow>): Record<AckAction | "waiting", number> {
  const out = { accept: 0, question: 0, decline: 0, waiting: 0 };
  for (const id of itemIds) {
    const a = acks.get(id);
    if (a) out[a.action] += 1;
    else out.waiting += 1;
  }
  return out;
}
