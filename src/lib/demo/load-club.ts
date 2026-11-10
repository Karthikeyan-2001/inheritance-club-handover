// Writes the SYNTHETIC demo club into a workspace. Used by the seed script (the shared club,
// with the fixture's own ids) and by "Load demo club" (a visitor's own copy, with fresh ids).
// No server-only import and explicit .ts extensions: scripts/seed.ts runs this under Node.
// The service-role client is injected; nothing here reads environment variables.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "../hash.ts";
import type { Database } from "../supabase/database.types.ts";
import { DEMO_USERS, type DemoUserKey } from "./demo-users.ts";
import {
  ALIASES,
  CONTEXT_ITEMS,
  DOCKET_ENTRIES,
  EVENTS,
  EVIDENCE,
  OBLIGATIONS,
  RELEASES,
  SEALED_ITEMS,
  SOURCES,
  byKey,
} from "./fixture.ts";

export type Db = SupabaseClient<Database>;

/** Maps a fixture row id to the id it gets in the target workspace. */
export type IdFor = (fixtureId: string) => string;

/** The shared club keeps the fixture's ids, so tests can assert exact rows. */
export const fixtureIds: IdFor = (id) => id;

/** A copy gets a new id for every fixture row, the same one each time it is asked. */
export function freshIds(newId: () => string = () => crypto.randomUUID()): IdFor {
  const map = new Map<string, string>();
  return (id) => {
    let v = map.get(id);
    if (!v) {
      v = newId();
      map.set(id, v);
    }
    return v;
  };
}

export type ClubTarget = {
  workspaceId: string;
  name: string;
  /** The shared club: visitors cannot delete it. */
  isDemo: boolean;
  /** Set for a visitor's copy; null for the shared club. */
  sandboxExpiresAt: string | null;
  users: Record<DemoUserKey, string>;
  ids: IdFor;
};

function check<T>(label: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

/**
 * Insert the workspace, its four memberships and every fixture row, as the service role.
 * Database triggers still run: evidence raises each item's level, the trust rule opens the
 * docket entry, and inserts are audited.
 */
export async function insertClub(admin: Db, t: ClubTarget): Promise<void> {
  const { workspaceId: ws, users, ids } = t;

  check("workspace", await admin.from("workspaces").insert({
    id: ws, name: t.name, created_by: users.arun, is_demo: t.isDemo, sandbox_expires_at: t.sandboxExpiresAt,
  }));
  check("memberships", await admin.from("memberships").insert(
    DEMO_USERS.map((u) => ({ workspace_id: ws, user_id: users[u.key], role: u.role })),
  ));

  check("sources", await admin.from("sources").insert(SOURCES.map((s) => ({
    id: ids(s.id), workspace_id: ws, type: s.type, filename: s.filename,
    access_level: s.access_level, uploaded_by: users[s.uploadedBy], sha256: sha256Hex(`synthetic-${s.key}`),
    event_count: EVENTS.filter((e) => e.source === s.key).length,
    read_summary: { synthetic: true, note: "Seeded demo data" },
  }))));

  check("events", await admin.from("events").insert(EVENTS.map((e) => ({
    id: ids(e.id), workspace_id: ws, source_id: ids(byKey(SOURCES, e.source).id),
    author: e.author, ts: e.ts, text: e.text, access_level: e.access_level, thread_id: e.source,
  }))));

  check("obligations", await admin.from("obligations").insert(OBLIGATIONS.map((o) => ({
    id: ids(o.id), workspace_id: ws, kind: o.kind, description: o.description,
    owed_by: o.owed_by, owed_to: o.owed_to, due_text: o.due_text, due_date: o.due_date,
    approval_required: o.approval_required, approver: o.approver, status: o.status,
    trust_state: o.trust_state, review_state: o.review_state, access_level: o.access_level,
  }))));

  // Evidence raises each obligation to the most restrictive cited event (DB trigger).
  check("evidence", await admin.from("evidence").insert(EVIDENCE.map((ev) => ({
    id: ids(ev.id), obligation_id: ids(byKey(OBLIGATIONS, ev.obligation).id), event_id: ids(byKey(EVENTS, ev.event).id),
    quote: ev.quote, relation: ev.relation, verified: true,
  }))));

  check("context_items", await admin.from("context_items").insert(CONTEXT_ITEMS.map((c) => ({
    id: ids(c.id), obligation_id: ids(byKey(OBLIGATIONS, c.obligation).id), kind: c.kind, text: c.text, access_level: c.access_level,
  }))));

  // The trust rule has already opened these entries; give them their fixture ids and summaries.
  check("docket_entries", await admin.from("docket_entries").upsert(DOCKET_ENTRIES.map((d) => ({
    id: ids(d.id), workspace_id: ws, obligation_id: ids(byKey(OBLIGATIONS, d.obligation).id),
    claim_a_event: ids(byKey(EVENTS, d.claimA).id), claim_b_event: ids(byKey(EVENTS, d.claimB).id),
    quote_a: d.quoteA, quote_b: d.quoteB, summary: d.summary, origin: "rule",
  })), { onConflict: "obligation_id,claim_a_event,claim_b_event" }));

  // Record what each accepted item was accepted with, so a later change to its status or trust
  // is flagged for re-review. Evidence has now settled trust.
  const accepted = check("accepted items", await admin.from("obligations").select("id, status, trust_state")
    .eq("workspace_id", ws).in("review_state", ["accepted", "edited"]));
  for (const o of accepted ?? []) {
    check("reviewed baseline", await admin.from("obligations")
      .update({ reviewed_status: o.status, reviewed_trust: o.trust_state }).eq("id", o.id));
  }

  check("sealed_items", await admin.from("sealed_items").insert(SEALED_ITEMS.map((s) => ({
    id: ids(s.id), workspace_id: ws, obligation_id: ids(byKey(OBLIGATIONS, s.obligation).id),
    holder_role: s.holder_role, topic_label: s.topic_label, approved_by: users[s.approvedBy],
  }))));

  check("aliases", await admin.from("aliases").insert(ALIASES.map((a) => ({
    id: ids(a.id), workspace_id: ws, canonical: a.canonical, variants: [...a.variants], kind: a.kind,
  }))));
}

/** A client signed in as one of the club's own users. */
export type SignInAs = (key: DemoUserKey) => Promise<Db>;

/**
 * The steps that must run as the club's own people, so the same rules and audit apply as in
 * the app: releases (as the releaser), and optionally the sign-off of version 1 (the outgoing
 * lead marks the draft ready, the advisor approves it).
 */
export async function finishClub(
  as: SignInAs,
  t: Pick<ClubTarget, "workspaceId" | "ids">,
  options: { approveFirst?: boolean } = {},
): Promise<void> {
  for (const r of RELEASES) {
    check("release_item", await (await as(r.by)).rpc("release_item", {
      p_target_type: "obligation", p_target_id: t.ids(byKey(OBLIGATIONS, r.obligation).id),
      p_to_role: r.toRole, p_reason: r.reason,
    }));
  }
  if (!options.approveFirst) return;
  check("mark_ready", await (await as("arun")).rpc("mark_ready", {
    p_workspace: t.workspaceId, p_reason: "Reviewed the accepted items against their quotes.",
  }));
  check("approve_version", await (await as("meena")).rpc("approve_version", {
    p_workspace: t.workspaceId, p_reason: "Version 1: the committee's handover, checked with the outgoing lead.",
  }));
}

/** Wrap a sign-in so each user signs in at most once (auth sign-ins are rate limited). */
export function memoSignIn(signIn: SignInAs): SignInAs {
  const cache = new Map<DemoUserKey, Promise<Db>>();
  return (key) => {
    let p = cache.get(key);
    if (!p) {
      p = signIn(key);
      cache.set(key, p);
    }
    return p;
  };
}
