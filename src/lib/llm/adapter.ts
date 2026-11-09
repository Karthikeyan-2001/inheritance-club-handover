// The single entry point for language-model calls (CLAUDE.md, non-negotiable 10).
// Structured output validated with Zod, one retry on invalid output, responses cached by
// prompt hash, typed errors, swappable provider, and a daily call budget.

import type { z } from "zod";
import { LlmBudgetError, LlmConfigError, LlmInvalidOutputError } from "./errors.ts";
import { promptHash } from "./hash.ts";
import type { Effort, LlmCache, LlmProvider, ModelTier, Usage } from "./types.ts";

export type GenerateOptions<S extends z.ZodType> = {
  schema: S;
  system: string;
  user: string;
  modelTier: ModelTier;
  /** Short label for the kind of call; part of the cache key and used by the fake provider. */
  task?: string;
  maxTokens?: number;
  effort?: Effort;
};

export type GenerateDeps = {
  provider?: LlmProvider;
  cache?: LlmCache;
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

export type GenerateResult<T> = { data: T; cached: boolean; model: string; usage: Usage };

const DEFAULT_DAILY_LIMIT = 500;

export function modelFor(tier: ModelTier, env: Record<string, string | undefined> = process.env): string {
  const model = tier === "fast" ? env.LLM_MODEL_FAST : env.LLM_MODEL_STRONG;
  if (!model) throw new LlmConfigError(`${tier === "fast" ? "LLM_MODEL_FAST" : "LLM_MODEL_STRONG"} is not set.`);
  return model;
}

/** Start of the current day in IST, as an instant. The budget resets at IST midnight. */
export function istDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 330 * 60_000);
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export async function generateStructured<S extends z.ZodType>(
  opts: GenerateOptions<S>,
  deps: GenerateDeps = {},
): Promise<GenerateResult<z.infer<S>>> {
  const env = deps.env ?? process.env;
  const model = modelFor(opts.modelTier, env);
  const provider = deps.provider ?? new (await import("./provider-anthropic.ts")).AnthropicProvider();
  const cache = deps.cache ?? new (await import("./cache-supabase.ts")).SupabaseLlmCache();
  const task = opts.task ?? "generic";
  const hash = promptHash({ provider: provider.name, model, task, system: opts.system, user: opts.user, schema: opts.schema });

  const hit = await cache.get(hash);
  if (hit) {
    const parsed = opts.schema.safeParse(hit.output);
    if (parsed.success) return { data: parsed.data, cached: true, model: hit.model || model, usage: hit.usage };
  }

  const limit = Number(env.LLM_MAX_CALLS_PER_DAY ?? DEFAULT_DAILY_LIMIT);
  if ((await cache.countSince(istDayStart((deps.now ?? (() => new Date()))()))) >= limit) {
    throw new LlmBudgetError(limit);
  }

  const request = {
    task,
    model,
    system: opts.system,
    user: opts.user,
    schema: opts.schema,
    maxTokens: opts.maxTokens ?? 8000,
    effort: opts.effort ?? (opts.modelTier === "fast" ? "low" : "medium"),
  } as const;

  let issues: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.complete(request);
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    const parsed = opts.schema.safeParse(res.output);
    if (parsed.success) {
      await cache.put(hash, { output: parsed.data, model: res.model, usage });
      return { data: parsed.data, cached: false, model: res.model, usage };
    }
    issues = res.output === null ? [`no parseable output (stop reason: ${res.stopReason ?? "unknown"})`] : issuesOf(parsed.error);
  }
  throw new LlmInvalidOutputError(issues);
}
