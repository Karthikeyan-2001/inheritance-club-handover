import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type QuoteSource = { author: string | null; ts: string | null; type: string | null };

/**
 * Who said each quoted message and in which kind of file, read through the viewer's session: a
 * message the role cannot read is simply missing from the map (and so stays unnamed). Used to
 * label the outgoing lead's answers to gap questions ("Stated by the outgoing lead").
 */
export async function loadQuoteSources(supabase: Db, eventIds: readonly string[]): Promise<{ sources: Map<string, QuoteSource>; error: boolean }> {
  const ids = [...new Set(eventIds)];
  const sources = new Map<string, QuoteSource>();
  for (let i = 0; i < ids.length; i += 150) {
    const res = await supabase.from("events").select("id, author, ts, sources(type)").in("id", ids.slice(i, i + 150));
    if (res.error) return { sources, error: true };
    for (const e of res.data ?? []) sources.set(e.id, { author: e.author, ts: e.ts, type: e.sources?.type ?? null });
  }
  return { sources, error: false };
}
