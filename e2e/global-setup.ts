import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { isLocalUrl, readSeedEnv, seed } from "../scripts/seed.ts";

// Reset the synthetic demo workspace before e2e runs against a local stack, and forget the
// offline fake model's saved answers (they are keyed by prompt, so a changed fake would
// otherwise be served stale). Against a deployment (E2E_BASE_URL) we never touch data.
export default async function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const env = readSeedEnv();
  if (!isLocalUrl(env.url)) throw new Error("e2e seeding only runs against local Supabase");
  await seed(env, () => {});
  const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from("llm_cache").delete().like("model", "fake:%");
  if (error) throw new Error(`could not clear the fake model's cache: ${error.message}`);
}
