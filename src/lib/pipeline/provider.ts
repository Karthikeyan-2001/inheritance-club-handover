import { LlmConfigError } from "../llm/errors.ts";
import { AnthropicProvider } from "../llm/provider-anthropic.ts";
import { FakeProvider } from "../llm/provider-fake.ts";
import type { LlmProvider } from "../llm/types.ts";
import { fakeExtract } from "./fake-extract.ts";
import { fakeDuties, fakeDutyContext, fakeFollowup, fakeMatch } from "./fake-pipeline.ts";
import { DUTIES_TASK, DUTY_CONTEXT_TASK, EXTRACT_TASK, FOLLOWUP_TASK, MATCH_TASK } from "./tasks.ts";

/** The provider the pipeline uses: Anthropic by default; LLM_PROVIDER=fake for offline tests. */
export function pipelineProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  if ((env.LLM_PROVIDER ?? "anthropic") === "fake") {
    if (env.VERCEL_ENV === "production") throw new LlmConfigError("The fake language-model provider cannot run in production.");
    return new FakeProvider(fakeHandlers());
  }
  return new AnthropicProvider();
}

/** Offline handlers for every pipeline task. */
export function fakeHandlers() {
  return { [EXTRACT_TASK]: fakeExtract, [DUTIES_TASK]: fakeDuties, [FOLLOWUP_TASK]: fakeFollowup, [DUTY_CONTEXT_TASK]: fakeDutyContext, [MATCH_TASK]: fakeMatch };
}
