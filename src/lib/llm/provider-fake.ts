import type { LlmProvider, ProviderRequest, ProviderResponse } from "./types.ts";

export type FakeHandler = (request: ProviderRequest) => unknown;

/**
 * Offline provider for tests and local e2e runs (LLM_PROVIDER=fake). Each task has a
 * handler that returns the structured output a model would. Never used in production.
 */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  calls: ProviderRequest[] = [];
  private handlers: Record<string, FakeHandler>;

  constructor(handlers: Record<string, FakeHandler>) {
    this.handlers = handlers;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const handler = this.handlers[request.task];
    if (!handler) throw new Error(`FakeProvider has no handler for task "${request.task}"`);
    return { output: handler(request), model: `fake:${request.model}`, stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
