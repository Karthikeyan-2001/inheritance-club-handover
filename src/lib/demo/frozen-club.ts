// A whole SYNTHETIC club frozen from one real build: its files' messages and the ledger the
// pipeline made from them, written by scripts/freeze-demo.ts and committed as JSON. Visitors'
// demo copies load it, so they get a full year of records and a real model's ledger without
// a model call. Rows are keyed, not id'd: a copy gets fresh ids for every row.
// No server-only import and explicit .ts extensions: scripts run this under Node.

import type { AccessLevel } from "../access.ts";
import type { Database, Json } from "../supabase/database.types.ts";
import type { DemoUserKey } from "./demo-users.ts";
import type { Db } from "./load-club.ts";

type Enums = Database["public"]["Enums"];

/** A message, as "<source key>#<index in its file>". */
export type EventRef = `${string}#${number}`;

export type FrozenSource = {
  key: string;
  type: Enums["source_type"];
  filename: string;
  access_level: AccessLevel;
  uploadedBy: DemoUserKey;
  sha256: string;
  read_summary: NonNullable<Json>;
  /** In file order: a copy inserts them in this order, so `events.seq` follows the file. */
  events: { author: string | null; ts: string | null; text: string; thread_id: string | null; meta: NonNullable<Json> }[];
};

export type FrozenObligation = {
  key: string;
  kind: Enums["obligation_kind"];
  description: string;
  owed_by: string | null;
  owed_to: string | null;
  due_text: string | null;
  due_date: string | null;
  next_due: string | null;
  approval_required: string | null;
  approver: string | null;
  status: Enums["obligation_status"];
  /** Level it is inserted with; the database raises it to its most restrictive cited message. */
  access_level: AccessLevel;
  private_uploaders: DemoUserKey[];
  review_state: "draft" | "accepted";
  fulfilment_checked_at: string | null;
  period: string | null;
  cadence: string | null;
  lead_time: string | null;
  start_by: string | null;
  next_due_basis: string | null;
};

export type FrozenClub = {
  synthetic: true;
  name: string;
  /** Where it came from and how: the scenario, the model, the day the dates were computed for. */
  built: { scenario: string; model: string; builtOn: string; today: string; calls: number; note: string };
  sources: FrozenSource[];
  obligations: FrozenObligation[];
  evidence: { obligation: string; event: EventRef; quote: string; relation: Enums["evidence_relation"]; inferred: boolean }[];
  context: { obligation: string; event: EventRef; kind: Enums["context_kind"]; text: string; quote: string }[];
  links: { a: string; b: string; verdict: "same" | "possible"; method: "rule" | "model"; score: number | null }[];
  /** Summaries for the docket entries the trust rule opens by itself. */
  docket: { obligation: string; claimA: EventRef; claimB: EventRef; summary: string }[];
  aliases: { canonical: string; variants: string[]; kind: Enums["alias_kind"] }[];
  sealed: { obligation: string; holder_role: Enums["app_role"]; topic_label: string; approvedBy: DemoUserKey }[];
};

export function parseRef(ref: string): { source: string; index: number } {
  const i = ref.lastIndexOf("#");
  const index = Number(ref.slice(i + 1));
  if (i <= 0 || !Number.isInteger(index) || index < 0) throw new Error(`bad event reference: ${ref}`);
  return { source: ref.slice(0, i), index };
}

/** Every message a frozen row cites, with its text; throws on a reference to nothing. */
export function eventText(club: FrozenClub, ref: string): string {
  const { source, index } = parseRef(ref);
  const s = club.sources.find((x) => x.key === source);
  const e = s?.events[index];
  if (!e) throw new Error(`no message ${ref}`);
  return e.text;
}

function check<T>(label: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

export type FrozenTarget = {
  workspaceId: string;
  name: string;
  sandboxExpiresAt: string | null;
  users: Record<DemoUserKey, string>;
  newId?: () => string;
};

const EVENT_BATCH = 500;

/**
 * Insert a frozen club into a new workspace, as the service role. The usual triggers run:
 * evidence raises each item's level and sets its trust, the trust rule opens docket entries,
 * and inserts are audited. Returns the new id of every obligation, by key.
 */
export async function insertFrozenClub(admin: Db, club: FrozenClub, t: FrozenTarget): Promise<Map<string, string>> {
  const newId = t.newId ?? (() => crypto.randomUUID());
  const ws = t.workspaceId;
  const { users } = t;

  await insertEmptyClub(admin, t);

  const eventIds = new Map<string, string>();
  for (const s of club.sources) {
    const sourceId = newId();
    check("source", await admin.from("sources").insert({
      id: sourceId, workspace_id: ws, type: s.type, filename: s.filename, access_level: s.access_level,
      uploaded_by: users[s.uploadedBy], sha256: s.sha256, read_summary: s.read_summary, event_count: s.events.length,
    }));
    const rows = s.events.map((e, i) => {
      const id = newId();
      eventIds.set(`${s.key}#${i}`, id);
      return { id, workspace_id: ws, source_id: sourceId, author: e.author, ts: e.ts, text: e.text, thread_id: e.thread_id, meta: e.meta, access_level: s.access_level };
    });
    // In file order, batch after batch, so the identity `seq` follows the file.
    for (let i = 0; i < rows.length; i += EVENT_BATCH) check("events", await admin.from("events").insert(rows.slice(i, i + EVENT_BATCH)));
  }
  const ev = (ref: string) => {
    const id = eventIds.get(ref);
    if (!id) throw new Error(`no message ${ref}`);
    return id;
  };

  if (club.aliases.length) {
    check("aliases", await admin.from("aliases").insert(club.aliases.map((a) => ({ id: newId(), workspace_id: ws, canonical: a.canonical, variants: a.variants, kind: a.kind }))));
  }

  const ids = new Map(club.obligations.map((o) => [o.key, newId()]));
  const ob = (key: string) => {
    const id = ids.get(key);
    if (!id) throw new Error(`no item ${key}`);
    return id;
  };
  check("obligations", await admin.from("obligations").insert(club.obligations.map((o) => ({
    id: ob(o.key), workspace_id: ws, kind: o.kind, description: o.description, owed_by: o.owed_by, owed_to: o.owed_to,
    due_text: o.due_text, due_date: o.due_date, next_due: o.next_due, approval_required: o.approval_required, approver: o.approver,
    status: o.status, access_level: o.access_level, private_uploaders: o.private_uploaders.map((k) => users[k]),
    review_state: o.review_state, fulfilment_checked_at: o.fulfilment_checked_at, period: o.period, cadence: o.cadence,
    lead_time: o.lead_time, start_by: o.start_by, next_due_basis: o.next_due_basis,
  }))));

  check("evidence", await admin.from("evidence").insert(club.evidence.map((e) => ({
    id: newId(), obligation_id: ob(e.obligation), event_id: ev(e.event), quote: e.quote, relation: e.relation, verified: true, inferred: e.inferred,
  }))));
  if (club.context.length) {
    check("context_items", await admin.from("context_items").insert(club.context.map((c) => ({
      id: newId(), obligation_id: ob(c.obligation), kind: c.kind, text: c.text, event_id: ev(c.event), quote: c.quote, verified: true,
      // The context_item_provenance trigger sets the level and uploaders from the cited message.
      access_level: club.sources.find((s) => s.key === parseRef(c.event).source)!.access_level,
    }))));
  }
  if (club.links.length) {
    // Links are stored with a < b; fresh ids may sort either way.
    check("obligation_links", await admin.from("obligation_links").insert(club.links.map((l) => {
      const [a, b] = [ob(l.a), ob(l.b)].sort();
      return { id: newId(), workspace_id: ws, a, b, verdict: l.verdict, method: l.method, score: l.score };
    })));
  }

  // The trust rule has opened the docket entries; give them the summaries of the build.
  for (const d of club.docket) {
    check("docket summary", await admin.from("docket_entries").update({ summary: d.summary })
      .eq("obligation_id", ob(d.obligation)).eq("claim_a_event", ev(d.claimA)).eq("claim_b_event", ev(d.claimB)));
  }

  // Record what each accepted item was accepted with (evidence has settled trust), so a later
  // change to its status or trust is flagged for re-review.
  const accepted = check("accepted items", await admin.from("obligations").select("id, status, trust_state").eq("workspace_id", ws).eq("review_state", "accepted"));
  for (const o of accepted ?? []) {
    check("reviewed baseline", await admin.from("obligations").update({ reviewed_status: o.status, reviewed_trust: o.trust_state }).eq("id", o.id));
  }

  if (club.sealed.length) {
    check("sealed_items", await admin.from("sealed_items").insert(club.sealed.map((s) => ({
      id: newId(), workspace_id: ws, obligation_id: ob(s.obligation), holder_role: s.holder_role, topic_label: s.topic_label, approved_by: users[s.approvedBy],
    }))));
  }
  return ids;
}

/** An empty club: the workspace and its four people, nothing imported yet. */
export async function insertEmptyClub(admin: Db, t: FrozenTarget): Promise<void> {
  check("workspace", await admin.from("workspaces").insert({
    id: t.workspaceId, name: t.name, created_by: t.users.arun, is_demo: false, sandbox_expires_at: t.sandboxExpiresAt,
  }));
  const roles: Record<DemoUserKey, Enums["app_role"]> = { arun: "outgoing_lead", meena: "advisor", kavya: "incoming_lead", divya: "treasurer" };
  check("memberships", await admin.from("memberships").insert(
    (Object.keys(roles) as DemoUserKey[]).map((k) => ({ workspace_id: t.workspaceId, user_id: t.users[k], role: roles[k] })),
  ));
}
