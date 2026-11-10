import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { purgeOne } from "../src/lib/demo/sandbox.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { isLocalUrl, readSeedEnv } from "../scripts/seed.ts";
import { reseedDemo } from "./reseed.ts";

// Reset the synthetic demo workspace before e2e runs against a local stack, and forget the
// offline fake model's saved answers (they are keyed by prompt, so a changed fake would
// otherwise be served stale). Against a deployment (E2E_BASE_URL) we never touch data.
export default async function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const env = readSeedEnv();
  if (!isLocalUrl(env.url)) throw new Error("e2e seeding only runs against local Supabase");
  await reseedDemo();
  const admin = createClient<Database>(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from("llm_cache").delete().like("model", "fake:%");
  if (error) throw new Error(`could not clear the fake model's cache: ${error.message}`);
  // Remove visitors' demo copies left by earlier runs (local only).
  const { data: copies, error: cErr } = await admin.from("demo_sandboxes").select("id, user_ids");
  if (cErr) throw new Error(`could not list demo copies: ${cErr.message}`);
  for (const row of copies ?? []) await purgeOne(admin, row);
}
