// Seeds the SYNTHETIC demo workspace and the four demo accounts.
//
//   pnpm seed                 # local Supabase (default)
//   pnpm seed -- --remote     # hosted project (explicit opt-in)
//
// Uses the secret (service-role) key, so it runs only on a developer machine, never in
// the browser or on Vercel. Idempotent: users are upserted and the demo workspace is
// deleted (via delete_workspace) and rebuilt with fixed ids.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "../src/lib/hash.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { DEMO_USERS, type DemoUserKey } from "../src/lib/demo/demo-users.ts";
import {
  ALIASES,
  CONTEXT_ITEMS,
  DEMO_WORKSPACE,
  DOCKET_ENTRIES,
  EVENTS,
  EVIDENCE,
  OBLIGATIONS,
  RELEASES,
  SEALED_ITEMS,
  SOURCES,
  byKey,
} from "../src/lib/demo/fixture.ts";

type Admin = SupabaseClient<Database>;

export type SeedEnv = {
  url: string;
  publishableKey: string;
  secretKey: string;
  demoPassword: string;
};

export function readSeedEnv(env: NodeJS.ProcessEnv = process.env): SeedEnv {
  const missing: string[] = [];
  const get = (k: string) => {
    const v = env[k];
    if (!v) missing.push(k);
    return v ?? "";
  };
  const out = {
    url: get("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: get("SUPABASE_SECRET_KEY"),
    demoPassword: get("DEMO_USER_PASSWORD"),
  };
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}. Copy .env.example to .env.local and fill it in.`);
  }
  if (out.demoPassword.length < 6) {
    throw new Error("DEMO_USER_PASSWORD must be at least 6 characters.");
  }
  return out;
}

export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

function check<T>(label: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function upsertUsers(admin: Admin, password: string): Promise<Record<DemoUserKey, string>> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const ids = {} as Record<DemoUserKey, string>;
  for (const u of DEMO_USERS) {
    const existing = data.users.find((x) => x.email === u.email);
    const attrs = {
      password,
      email_confirm: true,
      user_metadata: { name: u.name, demo: true, synthetic: true },
    };
    if (existing) {
      const res = await admin.auth.admin.updateUserById(existing.id, attrs);
      if (res.error) throw new Error(`update ${u.email}: ${res.error.message}`);
      ids[u.key] = existing.id;
    } else {
      const res = await admin.auth.admin.createUser({ email: u.email, ...attrs });
      if (res.error || !res.data.user) throw new Error(`create ${u.email}: ${res.error?.message}`);
      ids[u.key] = res.data.user.id;
    }
  }
  return ids;
}

export async function seed(env: SeedEnv, log: (msg: string) => void = console.log): Promise<Record<DemoUserKey, string>> {
  const admin: Admin = createClient<Database>(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const users = await upsertUsers(admin, env.demoPassword);
  log(`users: ${DEMO_USERS.map((u) => u.name).join(", ")}`);

  // Reset the demo workspace (delete_workspace allows the service role).
  const existing = check("find workspace", await admin.from("workspaces").select("id").eq("id", DEMO_WORKSPACE.id));
  if (existing?.length) {
    check("delete workspace", await admin.rpc("delete_workspace", { p_workspace: DEMO_WORKSPACE.id, p_reason: "seed reset" }));
  }

  check("workspace", await admin.from("workspaces").insert({ id: DEMO_WORKSPACE.id, name: DEMO_WORKSPACE.name, created_by: users.arun, is_demo: true }));
  check("memberships", await admin.from("memberships").insert(
    DEMO_USERS.map((u) => ({ workspace_id: DEMO_WORKSPACE.id, user_id: users[u.key], role: u.role })),
  ));

  check("sources", await admin.from("sources").insert(SOURCES.map((s) => ({
    id: s.id, workspace_id: DEMO_WORKSPACE.id, type: s.type, filename: s.filename,
    access_level: s.access_level, uploaded_by: users[s.uploadedBy], sha256: sha256Hex(`synthetic-${s.key}`),
    event_count: EVENTS.filter((e) => e.source === s.key).length,
    read_summary: { synthetic: true, note: "Seeded demo data" },
  }))));

  check("events", await admin.from("events").insert(EVENTS.map((e) => ({
    id: e.id, workspace_id: DEMO_WORKSPACE.id, source_id: byKey(SOURCES, e.source).id,
    author: e.author, ts: e.ts, text: e.text, access_level: e.access_level, thread_id: e.source,
  }))));

  check("obligations", await admin.from("obligations").insert(OBLIGATIONS.map((o) => ({
    id: o.id, workspace_id: DEMO_WORKSPACE.id, kind: o.kind, description: o.description,
    owed_by: o.owed_by, owed_to: o.owed_to, due_text: o.due_text, due_date: o.due_date,
    approval_required: o.approval_required, approver: o.approver, status: o.status,
    trust_state: o.trust_state, review_state: o.review_state, access_level: o.access_level,
  }))));

  // Evidence raises each obligation to the most restrictive cited event (DB trigger).
  check("evidence", await admin.from("evidence").insert(EVIDENCE.map((ev) => ({
    id: ev.id, obligation_id: byKey(OBLIGATIONS, ev.obligation).id, event_id: byKey(EVENTS, ev.event).id,
    quote: ev.quote, relation: ev.relation, verified: true,
  }))));

  check("context_items", await admin.from("context_items").insert(CONTEXT_ITEMS.map((c) => ({
    id: c.id, obligation_id: byKey(OBLIGATIONS, c.obligation).id, kind: c.kind, text: c.text, access_level: c.access_level,
  }))));

  check("docket_entries", await admin.from("docket_entries").insert(DOCKET_ENTRIES.map((d) => ({
    id: d.id, workspace_id: DEMO_WORKSPACE.id, claim_a_event: byKey(EVENTS, d.claimA).id,
    claim_b_event: byKey(EVENTS, d.claimB).id, summary: d.summary,
  }))));

  check("sealed_items", await admin.from("sealed_items").insert(SEALED_ITEMS.map((s) => ({
    id: s.id, workspace_id: DEMO_WORKSPACE.id, obligation_id: byKey(OBLIGATIONS, s.obligation).id,
    holder_role: s.holder_role, topic_label: s.topic_label, approved_by: users[s.approvedBy],
  }))));

  check("aliases", await admin.from("aliases").insert(ALIASES.map((a) => ({
    id: a.id, workspace_id: DEMO_WORKSPACE.id, canonical: a.canonical, variants: [...a.variants], kind: a.kind,
  }))));

  // Releases go through release_item() as the releasing user, so the rules and audit apply.
  for (const r of RELEASES) {
    const releaser = DEMO_USERS.find((u) => u.key === r.by);
    if (!releaser) throw new Error(`unknown releaser ${r.by}`);
    const client = createClient<Database>(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: releaser.email, password: env.demoPassword });
    if (signIn.error) throw new Error(`sign in ${releaser.email}: ${signIn.error.message}`);
    check("release_item", await client.rpc("release_item", {
      p_target_type: "obligation", p_target_id: byKey(OBLIGATIONS, r.obligation).id,
      p_to_role: r.toRole, p_reason: r.reason,
    }));
    await client.auth.signOut();
  }

  log(`workspace "${DEMO_WORKSPACE.name}": ${SOURCES.length} sources, ${EVENTS.length} events, ${OBLIGATIONS.length} obligations`);
  return users;
}

async function main() {
  const env = readSeedEnv();
  const remote = process.argv.includes("--remote");
  if (!isLocalUrl(env.url) && !remote) {
    throw new Error(`Refusing to seed non-local ${new URL(env.url).host} without --remote.`);
  }
  console.log(`Seeding ${new URL(env.url).host} (synthetic demo data)`);
  await seed(env);
  console.log("Done.");
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
