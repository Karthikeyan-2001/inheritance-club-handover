import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured, istDayStart, modelFor } from "./adapter";
import { MemoryLlmCache } from "./cache-memory";
import { LlmBudgetError, LlmConfigError, LlmInvalidOutputError, LlmRateLimitError } from "./errors";
import { promptHash } from "./hash";
import { FakeProvider } from "./provider-fake";
import type { ProviderRequest } from "./types";

const Schema = z.object({ answer: z.number() });
const ENV = { LLM_MODEL_FAST: "fast-model", LLM_MODEL_STRONG: "strong-model" };
const base = { schema: Schema, system: "sys", user: "what is 2+2?", modelTier: "fast" as const, task: "math" };

/** A provider that returns the given outputs in order (or throws them). */
function scripted(...outputs: unknown[]) {
  return new FakeProvider({
    math: () => {
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
}

describe("generateStructured", () => {
  it("returns validated data, then serves the same prompt from the cache", async () => {
    const provider = scripted({ answer: 4 });
    const cache = new MemoryLlmCache();
    const first = await generateStructured(base, { provider, cache, env: ENV });
    expect(first).toMatchObject({ data: { answer: 4 }, cached: false, model: "fake:fast-model" });
    const second = await generateStructured(base, { provider, cache, env: ENV });
    expect(second).toMatchObject({ data: { answer: 4 }, cached: true });
    expect(provider.calls).toHaveLength(1);
  });

  it("retries once when the output has the wrong shape", async () => {
    const provider = scripted({ answer: "four" }, { answer: 4 });
    const r = await generateStructured(base, { provider, cache: new MemoryLlmCache(), env: ENV });
    expect(r.data).toEqual({ answer: 4 });
    expect(provider.calls).toHaveLength(2);
  });

  it("gives up after the second invalid output, with the issues, and caches nothing", async () => {
    const provider = scripted({ answer: "four" }, null);
    const cache = new MemoryLlmCache();
    const attempt = generateStructured(base, { provider, cache, env: ENV });
    await expect(attempt).rejects.toBeInstanceOf(LlmInvalidOutputError);
    await expect(generateStructured(base, { provider: scripted({ wrong: 1 }, { wrong: 2 }), cache, env: ENV })).rejects.toMatchObject({
      code: "invalid_output",
      issues: [expect.stringContaining("answer")],
    });
    expect(cache.size).toBe(0);
  });

  it("passes typed provider errors through", async () => {
    const provider = scripted(new LlmRateLimitError(2000));
    await expect(generateStructured(base, { provider, cache: new MemoryLlmCache(), env: ENV })).rejects.toMatchObject({
      code: "rate_limit",
      retryable: true,
      retryAfterMs: 2000,
    });
  });

  it("maps tiers to models from env and picks a sensible default effort", async () => {
    expect(modelFor("strong", ENV)).toBe("strong-model");
    expect(() => modelFor("fast", {})).toThrow(LlmConfigError);
    const provider = scripted({ answer: 1 }, { answer: 2 });
    await generateStructured(base, { provider, cache: new MemoryLlmCache(), env: ENV });
    await generateStructured({ ...base, modelTier: "strong", user: "other" }, { provider, cache: new MemoryLlmCache(), env: ENV });
    expect(provider.calls.map((c: ProviderRequest) => [c.model, c.effort])).toEqual([
      ["fast-model", "low"],
      ["strong-model", "medium"],
    ]);
  });

  it("stops at the daily budget but still serves cached answers", async () => {
    const cache = new MemoryLlmCache();
    await generateStructured(base, { provider: scripted({ answer: 4 }), cache, env: { ...ENV, LLM_MAX_CALLS_PER_DAY: "1" } });
    const blocked = scripted({ answer: 5 });
    await expect(
      generateStructured({ ...base, user: "new prompt" }, { provider: blocked, cache, env: { ...ENV, LLM_MAX_CALLS_PER_DAY: "1" } }),
    ).rejects.toBeInstanceOf(LlmBudgetError);
    expect(blocked.calls).toHaveLength(0);
    const again = await generateStructured(base, { provider: blocked, cache, env: { ...ENV, LLM_MAX_CALLS_PER_DAY: "1" } });
    expect(again.cached).toBe(true);
  });
});

describe("promptHash", () => {
  const parts = { provider: "anthropic", model: "m", task: "t", system: "s", user: "u", schema: Schema };
  it("is stable, and changes with any input that changes the answer", () => {
    expect(promptHash(parts)).toBe(promptHash({ ...parts }));
    for (const change of [{ model: "m2" }, { user: "u2" }, { system: "s2" }, { task: "t2" }, { provider: "fake" }, { schema: z.object({ answer: z.string() }) }]) {
      expect(promptHash({ ...parts, ...change })).not.toBe(promptHash(parts));
    }
  });
});

describe("istDayStart", () => {
  it("resets at IST midnight", () => {
    expect(istDayStart(new Date("2026-11-09T20:00:00Z")).toISOString()).toBe("2026-11-09T18:30:00.000Z");
    expect(istDayStart(new Date("2026-11-09T17:00:00Z")).toISOString()).toBe("2026-11-08T18:30:00.000Z");
  });
});
