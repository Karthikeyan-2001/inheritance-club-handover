import type { CachedEntry, LlmCache } from "./types.ts";

/** In-process cache for tests and scripts. */
export class MemoryLlmCache implements LlmCache {
  private entries = new Map<string, CachedEntry & { at: Date }>();

  async get(hash: string): Promise<CachedEntry | null> {
    const e = this.entries.get(hash);
    return e ? { output: e.output, model: e.model, usage: e.usage } : null;
  }

  async put(hash: string, entry: CachedEntry): Promise<void> {
    this.entries.set(hash, { ...entry, at: new Date() });
  }

  async countSince(since: Date): Promise<number> {
    return [...this.entries.values()].filter((e) => e.at >= since).length;
  }

  get size(): number {
    return this.entries.size;
  }
}
