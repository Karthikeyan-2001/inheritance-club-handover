import { createHash } from "node:crypto";
import { z } from "zod";

/** Bump to invalidate every cached response (e.g. after a pipeline change that keeps prompts identical). */
export const PROMPT_CACHE_VERSION = 1;

/** Stable hash of everything that determines a response. */
export function promptHash(parts: { provider: string; model: string; task: string; system: string; user: string; schema: z.ZodType }): string {
  const body = JSON.stringify({
    v: PROMPT_CACHE_VERSION,
    provider: parts.provider,
    model: parts.model,
    task: parts.task,
    system: parts.system,
    user: parts.user,
    schema: z.toJSONSchema(parts.schema),
  });
  return createHash("sha256").update(body).digest("hex");
}
