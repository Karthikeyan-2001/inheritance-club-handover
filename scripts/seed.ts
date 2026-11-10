// Seeds the SYNTHETIC demo workspace and the four demo accounts.
//
//   pnpm seed                 # local Supabase (default)
//   pnpm seed -- --remote     # hosted project (explicit opt-in)
//
// Uses the secret (service-role) key, so it runs only on a developer machine, never in
// the browser or on Vercel. Idempotent: users are upserted and the demo workspace is
// deleted (via delete_workspace) and rebuilt with fixed ids.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { DEMO_USERS, type DemoUserKey } from "../src/lib/demo/demo-users.ts";
import { DEMO_WORKSPACE, EVENTS, OBLIGATIONS, SOURCES } from "../src/lib/demo/fixture.ts";
import { finishClub, fixtureIds, insertClub, memoSignIn } from "../src/lib/demo/load-club.ts";

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
      user_metadata: { name: u.name, demo: true, demo_key: u.key, synthetic: true },
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

export type SeedOptions = {
  /** Mark the accepted draft ready (as the outgoing lead) and approve version 1 (as the advisor). */
  approveFirst?: boolean;
};

export async function seed(
  env: SeedEnv,
  log: (msg: string) => void = console.log,
  options: SeedOptions = {},
): Promise<Record<DemoUserKey, string>> {
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

  const target = {
    workspaceId: DEMO_WORKSPACE.id, name: DEMO_WORKSPACE.name, isDemo: true, sandboxExpiresAt: null,
    users, ids: fixtureIds,
  };
  await insertClub(admin, target);

  // Releases and the sign-off run as the club's own users, so the rules and audit apply.
  const signIns: SupabaseClient<Database>[] = [];
  const as = memoSignIn(async (key: DemoUserKey) => {
    const user = DEMO_USERS.find((u) => u.key === key);
    if (!user) throw new Error(`unknown user ${key}`);
    const client = createClient<Database>(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await client.auth.signInWithPassword({ email: user.email, password: env.demoPassword });
    if (signIn.error) throw new Error(`sign in ${user.email}: ${signIn.error.message}`);
    signIns.push(client);
    return client;
  });
  await finishClub(as, target, { approveFirst: options.approveFirst });
  await Promise.all(signIns.map((c) => c.auth.signOut()));
  if (options.approveFirst) log("version 1 approved");

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
  await seed(env, console.log, { approveFirst: true });
  console.log("Done.");
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
