// Score the whole pipeline (commitments, recurring duties, follow-up and context, matching,
// trust, levels and leaks) on a scenario against its ground truth.
//
//   pnpm eval:pipeline                                   # mini scenario: estimate only, no API call
//   pnpm eval:pipeline -- --scenario year                # another scenario (mini, year, photo)
//   pnpm eval:pipeline -- --scenario year --fake         # score the offline fake (free)
//   pnpm eval:pipeline -- --scenario year --yes          # call the real model (costs money)
//   pnpm eval:pipeline -- --yes --model claude-sonnet-5-5    # compare another model
//   pnpm eval:pipeline -- --yes --match-probe-only       # mini only: the fixed matching probe (one call)
//
// Runs entirely in memory (src/lib/pipeline/run-memory.ts): the same prompts, adapter and
// deterministic checks as the app, never touching the database. The estimate walks the same
// prompts with the offline fake first, so it counts the real number of calls and input tokens
// (follow-up and matching prompts depend on what is found, so those are close, not exact).

import { modelFor, generateStructured } from "../src/lib/llm/adapter.ts";
import { MemoryLlmCache } from "../src/lib/llm/cache-memory.ts";
import { FakeProvider } from "../src/lib/llm/provider-fake.ts";
import { AnthropicProvider } from "../src/lib/llm/provider-anthropic.ts";
import { istDayKey } from "../src/lib/format.ts";
import { loadScenario } from "../src/lib/eval/scenario.ts";
import { formatScorecard, scoreRun } from "../src/lib/eval/score.ts";
import { MATCH_SYSTEM, MatchSchema, buildMatchPrompt, postProcessMatches } from "../src/lib/pipeline/match.ts";
import { fakeHandlers } from "../src/lib/pipeline/provider.ts";
import { runInMemory } from "../src/lib/pipeline/run-memory.ts";
import { MATCH_TASK } from "../src/lib/pipeline/tasks.ts";
import { matchProbe, miniEvents, miniTruth } from "./mini-scenario.ts";

// Prices per million tokens (Claude API, cached 2026-10-06). Used for estimates only.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};
// Calibrated on the Phase 12 paid runs (Haiku 5.5, 10 Nov 2026): input was about 1.3 times the
// prompt text at 3.5 characters a token, plus about 1,500 tokens a call for the structured-output
// schema; output was 400 to 560 tokens a call. Both are rounded up, so the estimate errs high.
const INPUT_FACTOR = 1.3;
const INPUT_PER_CALL = 1500;
const OUTPUT_PER_CALL = 800;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const scenarioName = arg("--scenario") ?? "mini";
const env = { ...process.env, ...(arg("--model") ? { LLM_MODEL_FAST: arg("--model") } : {}) };
const fake = process.argv.includes("--fake");
const model = fake ? "offline fake" : modelFor("fast", env);
const price = PRICES[model];
const today = istDayKey(new Date().toISOString());
const usd = (inTok: number, outTok: number) => (price ? `about $${((inTok * price.input + outTok * price.output) / 1e6).toFixed(4)}` : "price unknown for this model");

const scenario = await loadScenario(scenarioName);

// Estimate: walk the same prompts with the offline fake and count calls and input tokens.
const tokens = (s: string) => Math.ceil(s.length / 3.5);
const dry = new FakeProvider(fakeHandlers());
const offline = await runInMemory(scenario.events, { provider: dry, cache: new MemoryLlmCache(), env: { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" }, today });
const byTask = new Map<string, { calls: number; input: number }>();
for (const c of dry.calls) {
  const t = byTask.get(c.task) ?? { calls: 0, input: 0 };
  t.calls++;
  t.input += Math.ceil(tokens(c.system + c.user) * INPUT_FACTOR) + INPUT_PER_CALL;
  byTask.set(c.task, t);
}
const estIn = [...byTask.values()].reduce((n, t) => n + t.input, 0);
const estOut = dry.calls.length * OUTPUT_PER_CALL;
console.log(`Scenario "${scenarioName}": ${scenario.events.length} messages in ${scenario.files.length} files (SYNTHETIC).`);
console.log(`About ${dry.calls.length} model calls: ${[...byTask].map(([k, t]) => `${k} ${t.calls}`).join(", ")}.`);
if (!fake) console.log(`Estimate on ${model}: about ${estIn} input + ${estOut} output tokens, ${usd(estIn, estOut)}.`);

const probe = scenarioName === "mini" ? matchProbe(await miniEvents(), miniTruth()) : null;
if (probe && !fake) {
  const probeTokens = Math.ceil(tokens(MATCH_SYSTEM + buildMatchPrompt(probe.pairs, probe.items).user) * INPUT_FACTOR) + INPUT_PER_CALL;
  console.log(`The matching probe alone (--match-probe-only): 1 call, about ${probeTokens} input tokens, ${usd(probeTokens, OUTPUT_PER_CALL)}.`);
}

/** The fixed matching probe (mini scenario): one model call over planted pairs, scored against the expected verdicts. */
async function runProbe() {
  if (!probe) return;
  const { user, refs } = buildMatchPrompt(probe.pairs, probe.items);
  const res = await generateStructured({ schema: MatchSchema, system: MATCH_SYSTEM, user, modelTier: "fast", task: MATCH_TASK }, { provider: new AnthropicProvider(), cache: new MemoryLlmCache(), env });
  const kept = postProcessMatches(res.data, refs);
  const verdictOf = (a: string, b: string) => (kept.same.some((p) => p.a === a && p.b === b) ? "same" : kept.possible.some((p) => p.a === a && p.b === b) ? "unsure" : "different");
  console.log("\nMatching probe (fixed pairs)");
  let right = 0;
  let falseSame = 0;
  for (const p of probe.pairs) {
    const got = verdictOf(p.a, p.b);
    if (got === p.expect) right++;
    if (got === "same" && p.expect === "different") falseSame++;
    console.log(`  ${got === p.expect ? "ok   " : "WRONG"} ${p.a} vs ${p.b}: expected ${p.expect}, got ${got}`);
  }
  console.log(`Probe: ${right}/${probe.pairs.length} right, ${falseSame} different pairs called the same. Dropped: ${JSON.stringify(kept.dropped)}.`);
  console.log(`Probe usage: ${res.usage.inputTokens} input + ${res.usage.outputTokens} output tokens (${usd(res.usage.inputTokens, res.usage.outputTokens)}).`);
}

if (fake) {
  console.log("\n" + formatScorecard(scoreRun(offline, scenario)));
  console.log(`\nOffline fake: ${offline.calls} calls, no cost. These numbers describe the rule-based stand-in, not a model.`);
} else if (!process.argv.includes("--yes")) {
  console.log("Dry run only. Re-run with -- --yes to call the model, or -- --fake to score the offline stand-in for free.");
} else if (process.argv.includes("--match-probe-only")) {
  if (!probe) throw new Error("The matching probe exists for the mini scenario only.");
  await runProbe();
} else {
  const res = await runInMemory(scenario.events, { provider: new AnthropicProvider(), cache: new MemoryLlmCache(), env, today });
  const card = scoreRun(res, scenario);
  console.log("\n" + formatScorecard(card));
  console.log(`Actual usage: ${res.calls} calls, ${res.usage.inputTokens} input + ${res.usage.outputTokens} output tokens (${usd(res.usage.inputTokens, res.usage.outputTokens)}).`);
  await runProbe();
}
