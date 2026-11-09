import { LlmConfigError } from "../llm/errors.ts";
import { AnthropicProvider } from "../llm/provider-anthropic.ts";
import { FakeProvider } from "../llm/provider-fake.ts";
import type { LlmProvider } from "../llm/types.ts";
import { fakeExtract } from "./fake-extract.ts";
import { EXTRACT_TASK } from "./tasks.ts";

/** The provider the pipeline uses: Anthropic by default; LLM_PROVIDER=fake for offline tests. */
export function pipelineProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  if ((env.LLM_PROVIDER ?? "anthropic") === "fake") {
    if (env.VERCEL_ENV === "production") throw new LlmConfigError("The fake language-model provider cannot run in production.");
    return new FakeProvider({ [EXTRACT_TASK]: fakeExtract });
  }
  return new AnthropicProvider();
}
