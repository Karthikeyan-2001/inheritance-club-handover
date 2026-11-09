import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmConfigError, LlmProviderError, LlmRateLimitError, LlmRefusalError, LlmTimeoutError } from "./errors";
import { AnthropicProvider, mapAnthropicError, type MessagesClient } from "./provider-anthropic";

const req = { task: "t", model: "claude-haiku-5-5", system: "sys", user: "hi", schema: z.object({ a: z.number() }), maxTokens: 1000, effort: "low" as const };

function clientReturning(message: object, seen: unknown[] = []): MessagesClient {
  return { messages: { parse: async (params: unknown) => (seen.push(params), message) } } as unknown as MessagesClient;
}

/** An SDK error instance without going through its constructor. */
function sdkError<T extends object>(cls: abstract new (...a: never[]) => T, props: Record<string, unknown> = {}): T {
  return Object.assign(Object.create(cls.prototype), props);
}

describe("AnthropicProvider", () => {
  it("sends structured-output config and returns the parsed output and usage", async () => {
    const seen: unknown[] = [];
    const p = new AnthropicProvider(
      clientReturning({ parsed_output: { a: 1 }, model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 3 } }, seen),
    );
    const r = await p.complete(req);
    expect(r).toEqual({ output: { a: 1 }, model: "claude-haiku-5-5", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 3 } });
    expect(seen[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1000,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      output_config: { effort: "low", format: expect.any(Object) },
    });
  });

  it("reports unparseable output as null so the adapter can retry", async () => {
    const p = new AnthropicProvider(clientReturning({ parsed_output: null, model: "m", stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }));
    expect((await p.complete(req)).output).toBeNull();
  });

  it("turns a refusal into a typed error", async () => {
    const p = new AnthropicProvider(
      clientReturning({ parsed_output: null, model: "m", stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 1, output_tokens: 0 } }),
    );
    await expect(p.complete(req)).rejects.toEqual(expect.objectContaining({ code: "refusal", category: "cyber" }));
    await expect(p.complete(req)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it("requires an API key when no client is given", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider()).toThrow(LlmConfigError);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("mapAnthropicError", () => {
  it("maps SDK errors to typed adapter errors", () => {
    expect(mapAnthropicError(sdkError(Anthropic.APIConnectionTimeoutError))).toBeInstanceOf(LlmTimeoutError);
    const rl = mapAnthropicError(sdkError(Anthropic.RateLimitError, { status: 429, headers: new Headers({ "retry-after": "3" }) }));
    expect(rl).toBeInstanceOf(LlmRateLimitError);
    expect((rl as LlmRateLimitError).retryAfterMs).toBe(3000);
    expect(mapAnthropicError(sdkError(Anthropic.AuthenticationError, { status: 401 }))).toBeInstanceOf(LlmConfigError);
    expect(mapAnthropicError(sdkError(Anthropic.BadRequestError, { status: 400 }))).toMatchObject({ code: "provider", retryable: false });
    expect(mapAnthropicError(sdkError(Anthropic.InternalServerError, { status: 529 }))).toMatchObject({ code: "provider", retryable: true, status: 529 });
    expect(mapAnthropicError(sdkError(Anthropic.APIConnectionError))).toBeInstanceOf(LlmProviderError);
  });
});
