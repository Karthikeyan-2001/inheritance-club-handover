import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { isLocalUrl, readSeedEnv, seed } from "../scripts/seed.ts";

/** Reset the synthetic demo club (with version 1 approved). Local Supabase only, never a deployment. */
export async function reseedDemo(): Promise<void> {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const env = readSeedEnv();
  if (!isLocalUrl(env.url)) throw new Error("e2e seeding only runs against local Supabase");
  await seed(env, () => {}, { approveFirst: true });
}
