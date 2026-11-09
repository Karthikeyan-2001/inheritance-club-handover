import { connection } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildHealth, type DbStatus } from "@/lib/health";
import { supabasePublicEnv } from "@/lib/supabase/env";

async function checkDb(): Promise<DbStatus> {
  const env = supabasePublicEnv();
  if (!env) return "not_configured";
  try {
    const client = createClient(env.url, env.key, { auth: { persistSession: false } });
    const { data, error } = await client.rpc("ping");
    return !error && data === true ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function GET() {
  // Render per request (cacheComponents would otherwise prerender this).
  await connection();
  const db = await checkDb();
  return Response.json(buildHealth(process.env, new Date(), db), {
    headers: { "cache-control": "no-store" },
  });
}
