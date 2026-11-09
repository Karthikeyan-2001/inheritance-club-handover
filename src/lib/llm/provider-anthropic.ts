import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  LlmConfigError,
  LlmProviderError,
  LlmRateLimitError,
  LlmRefusalError,
  LlmTimeoutError,
} from "./errors.ts";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "./types.ts";

/** The subset of the SDK client this provider uses, so tests can pass a stand-in. */
export type MessagesClient = Pick<Anthropic, "messages">;

function retryAfterMs(headers: Headers | undefined): number | null {
  const v = headers?.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  return Number.isFinite(secs) ? Math.max(0, secs * 1000) : null;
}

/** Map SDK errors to the adapter's typed errors (most specific first). */
export function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmTimeoutError();
  if (err instanceof Anthropic.RateLimitError) return new LlmRateLimitError(retryAfterMs(err.headers));
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmConfigError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new LlmProviderError("The language model rejected the request.", 400, false);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmProviderError("Could not reach the language model.", null, true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : null;
    const retryable = status === null || status >= 500 || status === 408 || status === 409;
    return new LlmProviderError(`The language model returned an error${status ? ` (${status})` : ""}.`, status, retryable);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Anthropic Claude via the official SDK. Structured output uses `output_config.format`
 * (JSON schema from Zod), the documented replacement for forced tool use, which current
 * Sonnet and Opus models reject.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: MessagesClient;

  constructor(client?: MessagesClient) {
    if (client) {
      this.client = client;
    } else {
      if (!process.env.ANTHROPIC_API_KEY) throw new LlmConfigError("ANTHROPIC_API_KEY is not set.");
      // Short timeout: each pipeline step must finish inside one serverless call.
      this.client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
    }
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    let message;
    try {
      message = await this.client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: zodOutputFormat(req.schema), effort: req.effort },
      });
    } catch (err) {
      throw mapAnthropicError(err);
    }
    if (message.stop_reason === "refusal") {
      const details = (message as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new LlmRefusalError(details?.category ?? null);
    }
    return {
      output: message.parsed_output ?? null,
      model: message.model,
      stopReason: message.stop_reason ?? null,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
