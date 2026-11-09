import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { isLocalUrl, readSeedEnv, seed } from "../scripts/seed.ts";

// Reset the synthetic demo workspace before e2e runs against a local stack.
// Against a deployment (E2E_BASE_URL) we never touch data.
export default async function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const env = readSeedEnv();
  if (!isLocalUrl(env.url)) throw new Error("e2e seeding only runs against local Supabase");
  await seed(env, () => {});
}
