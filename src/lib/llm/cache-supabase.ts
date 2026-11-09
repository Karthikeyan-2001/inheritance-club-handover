import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../supabase/database.types.ts";
import { LlmConfigError } from "./errors.ts";
import type { CachedEntry, LlmCache } from "./types.ts";

/**
 * The shared response cache in `llm_cache`. That table has no RLS policies, so it is
 * reachable only with the secret (service-role) key, which never leaves the server.
 * Keys are hashes of the full prompt, so reading an entry requires already holding the
 * exact text it was produced from.
 */
export class SupabaseLlmCache implements LlmCache {
  private db;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new LlmConfigError("The response cache needs SUPABASE_SECRET_KEY on the server.");
    this.db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async get(hash: string): Promise<CachedEntry | null> {
    const { data } = await this.db.from("llm_cache").select("response, model, usage").eq("hash", hash).maybeSingle();
    if (!data) return null;
    const usage = (data.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
    return {
      output: data.response,
      model: data.model ?? "",
      usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
    };
  }

  async put(hash: string, entry: CachedEntry): Promise<void> {
    await this.db
      .from("llm_cache")
      .upsert({
        hash,
        response: (entry.output ?? {}) as NonNullable<Json>,
        model: entry.model,
        usage: entry.usage as unknown as NonNullable<Json>,
      });
  }

  async countSince(since: Date): Promise<number> {
    const { count } = await this.db
      .from("llm_cache")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since.toISOString());
    return count ?? 0;
  }
}
