import type { z } from "zod";

export type ModelTier = "fast" | "strong";
export type Effort = "low" | "medium" | "high";
export type Usage = { inputTokens: number; outputTokens: number };

/** What the adapter asks a provider for. Providers are swappable; see provider-*.ts. */
export type ProviderRequest = {
  task: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType;
  maxTokens: number;
  effort: Effort;
};

/** `output` is unvalidated; the adapter validates it against the schema. */
export type ProviderResponse = {
  output: unknown;
  model: string;
  stopReason: string | null;
  usage: Usage;
};

export interface LlmProvider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type CachedEntry = { output: unknown; model: string; usage: Usage };

export interface LlmCache {
  get(hash: string): Promise<CachedEntry | null>;
  put(hash: string, entry: CachedEntry): Promise<void>;
  /** Uncached calls made since `since`, for the daily budget. */
  countSince(since: Date): Promise<number>;
}
