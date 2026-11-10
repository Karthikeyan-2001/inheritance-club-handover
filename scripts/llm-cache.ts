// Move saved model answers (SYNTHETIC data only) from the local cache to the hosted one, so a
// visitor who builds the ledger from the sample files, or rebuilds the demo year club, gets
// the saved answers at once and at no cost.
//
//   pnpm cache:export                 # local llm_cache -> data/demo/llm-cache.json (real-model rows only)
//   pnpm cache:warm                   # data/demo/llm-cache.json -> the hosted llm_cache (.env.hosted.local)
//
// Keys are hashes of the full prompt; an entry is only ever used by someone who already holds
// the exact prompt text. Every row comes from the synthetic scenarios built by freeze-demo.ts.
// Pre-loaded rows are stamped one day before the import, because the adapter's daily budget
// counts the rows created today, and pre-loaded answers are not live calls.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types.ts";
import { isLocalUrl } from "./seed.ts";

const FILE = "data/demo/llm-cache.json";
type Row = { hash: string; model: string | null; response: NonNullable<Json>; usage: Json | null };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed.");
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const mode = process.argv[2];

if (mode === "export") {
  if (!isLocalUrl(url)) throw new Error("Export reads the local cache only.");
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("llm_cache").select("hash, model, response, usage").not("model", "like", "fake%").order("hash").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  writeFileSync(FILE, JSON.stringify({ synthetic: true, note: "Model answers for the synthetic demo scenarios only.", rows }) + "\n");
  console.log(`Wrote ${rows.length} saved answers to ${FILE}.`);
} else if (mode === "import") {
  if (isLocalUrl(url) && !process.argv.includes("--local")) throw new Error("This imports into the hosted project; pass --local to import into a local stack instead.");
  const { rows } = JSON.parse(readFileSync(FILE, "utf8")) as { rows: Row[] };
  const stamp = new Date(Date.now() - 24 * 3600_000).toISOString();
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => ({ ...r, usage: r.usage ?? {}, created_at: stamp }));
    const { error } = await db.from("llm_cache").upsert(batch, { onConflict: "hash", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  console.log(`Loaded ${rows.length} saved answers into ${new URL(url).host} (existing entries kept).`);
} else {
  throw new Error("Usage: llm-cache.ts export | import");
}
