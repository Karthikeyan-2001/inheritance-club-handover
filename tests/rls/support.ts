// Shared helpers for the RLS integration tests. These talk to a real Supabase (local by
// default) through PostgREST, exactly as the app does, so RLS is what is under test.

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { DEMO_USERS, demoUser, type DemoUserKey } from "../../src/lib/demo/demo-users.ts";
import {
  ALIASES, CONTEXT_ITEMS, DOCKET_ENTRIES, EVENTS, EVIDENCE, OBLIGATIONS, SEALED_ITEMS, SOURCES,
} from "../../src/lib/demo/fixture.ts";
import { isLocalUrl, readSeedEnv, seed, type SeedEnv } from "../../scripts/seed.ts";

if (existsSync(".env.local")) loadEnvFile(".env.local");

export type Client = SupabaseClient<Database>;
export type Viewer = DemoUserKey | "member";

const REQUIRED = process.env.RLS_REQUIRED === "1";

function tryEnv(): SeedEnv | null {
  try {
    return readSeedEnv();
  } catch (err) {
    if (REQUIRED) throw err;
    return null;
  }
}

export const env = tryEnv();
export const hasEnv = env !== null;

if (!hasEnv) {
  console.warn(
    "\n⚠️  RLS integration tests SKIPPED: Supabase env not set.\n" +
      "   Run `pnpm db:start`, fill .env.local, then `pnpm test:rls`.\n",
  );
} else if (!isLocalUrl(env!.url)) {
  throw new Error("RLS tests mutate data and only run against local Supabase.");
}

function mustEnv(): SeedEnv {
  if (!env) throw new Error("Supabase env not configured");
  return env;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function anon(): Client {
  const e = mustEnv();
  return createClient<Database>(e.url, e.publishableKey, opts);
}

/** Service-role client: bypasses RLS. Used only for setup and for counting rows. */
export function admin(): Client {
  const e = mustEnv();
  return createClient<Database>(e.url, e.secretKey, opts);
}

export const MEMBER_EMAIL = "member.rls-test@example.com";

export async function signIn(viewer: Viewer): Promise<Client> {
  const e = mustEnv();
  const c = anon();
  const email = viewer === "member" ? MEMBER_EMAIL : demoUser(viewer).email;
  const { error } = await c.auth.signInWithPassword({ email, password: e.demoPassword });
  if (error) throw new Error(`sign in as ${viewer}: ${error.message}`);
  return c;
}

export async function signInAll(): Promise<Record<Viewer, Client>> {
  const entries = await Promise.all(
    (["arun", "meena", "kavya", "divya", "member"] as const).map(async (v) => [v, await signIn(v)] as const),
  );
  return Object.fromEntries(entries) as Record<Viewer, Client>;
}

/** Re-seed the demo workspace and add a temporary `member` user. Returns user ids. */
export async function resetDemo(): Promise<Record<Viewer, string>> {
  const e = mustEnv();
  const users = await seed(e, () => {});
  const a = admin();
  const { data: list } = await a.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let memberId = list?.users.find((u) => u.email === MEMBER_EMAIL)?.id;
  if (!memberId) {
    const res = await a.auth.admin.createUser({
      email: MEMBER_EMAIL, password: e.demoPassword, email_confirm: true,
      user_metadata: { name: "Test member", synthetic: true },
    });
    if (res.error || !res.data.user) throw new Error(`create member: ${res.error?.message}`);
    memberId = res.data.user.id;
  }
  const { DEMO_WORKSPACE } = await import("../../src/lib/demo/fixture.ts");
  const ins = await a.from("memberships").insert({ workspace_id: DEMO_WORKSPACE.id, user_id: memberId, role: "member" });
  if (ins.error) throw new Error(`member membership: ${ins.error.message}`);
  return { ...users, member: memberId };
}

/** Remove the temporary member and restore the pristine demo workspace for the app. */
export async function cleanup(): Promise<void> {
  const a = admin();
  const { data } = await a.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = data?.users.find((x) => x.email === MEMBER_EMAIL);
  if (u) await a.auth.admin.deleteUser(u.id);
  await seed(mustEnv(), () => {});
}

const KEY_BY_ID = new Map<string, string>(
  [...SOURCES, ...EVENTS, ...OBLIGATIONS, ...EVIDENCE, ...CONTEXT_ITEMS, ...DOCKET_ENTRIES, ...SEALED_ITEMS, ...ALIASES]
    .map((r) => [r.id, r.key]),
);

/** Map fixture ids back to their readable keys (O1, E5, ...), sorted. */
export function keys(rows: readonly { id: string }[] | null): string[] {
  return (rows ?? []).map((r) => KEY_BY_ID.get(r.id) ?? `?${r.id}`).sort(naturalSort);
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export const DEMO_USER_KEYS = DEMO_USERS.map((u) => u.key);
