// Score commitment extraction on the mini scenario against its ground truth.
//
//   pnpm eval:extract            # estimate only, no API call
//   pnpm eval:extract -- --yes   # call the real model (costs money; cents for the mini scenario)
//
// Runs entirely in memory: parse files, chunk, call the model through the adapter, apply the
// deterministic checks, then compare with data/scenarios/mini/ground-truth.json.

import { readFileSync } from "node:fs";
import { generateStructured, modelFor } from "../src/lib/llm/adapter.ts";
import { MemoryLlmCache } from "../src/lib/llm/cache-memory.ts";
import { AnthropicProvider } from "../src/lib/llm/provider-anthropic.ts";
import { parseUpload } from "../src/lib/parsers/index.ts";
import {
  EXTRACTION_SYSTEM,
  ExtractionSchema,
  buildExtractionPrompt,
  chunkEvents,
  postProcess,
  type Candidate,
  type PipelineEvent,
} from "../src/lib/pipeline/extract.ts";
import { EXTRACT_TASK } from "../src/lib/pipeline/tasks.ts";
import { normaliseForQuote } from "../src/lib/pipeline/verify.ts";

const DIR = "data/scenarios/mini/";
// Prices per million tokens (Claude API, cached 2026-10-06). Used for estimates only.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

type Quote = { file: string; text: string };
const truth = JSON.parse(readFileSync(DIR + "ground-truth.json", "utf8")) as {
  commitments: { id: string; quote: Quote }[];
  decoys: Quote[];
};

const events: (PipelineEvent & { file: string })[] = [];
for (const file of ["whatsapp-committee.txt", "trello-board.json", "minutes.md"]) {
  const r = await parseUpload(file, new Uint8Array(readFileSync(DIR + file)));
  r.events.forEach((e, i) =>
    events.push({ id: `${file}#${i}`, file, author: e.author, ts: e.ts, text: e.text, threadId: e.threadId, sourceType: e.sourceType }),
  );
}
const chunks = chunkEvents(events);
const prompts = chunks.map((c) => buildExtractionPrompt(c));
const model = modelFor("fast");
const price = PRICES[model];
const estIn = prompts.reduce((n, p) => n + Math.ceil((EXTRACTION_SYSTEM.length + p.user.length) / 3.5), 0);
const estOut = chunks.length * 1500; // generous: the answer plus low-effort thinking
console.log(`Mini scenario: ${events.length} messages in ${chunks.length} model calls on ${model}.`);
if (price) {
  const usd = (estIn * price.input + estOut * price.output) / 1e6;
  console.log(`Estimate: about ${estIn} input + ${estOut} output tokens, about $${usd.toFixed(4)}.`);
}
if (!process.argv.includes("--yes")) {
  console.log("Dry run only. Re-run with -- --yes to call the model.");
} else {
  const provider = new AnthropicProvider();
  const cache = new MemoryLlmCache();
  const kept: Candidate[] = [];
  const dropped: Record<string, number> = {};
  let inTok = 0;
  let outTok = 0;
  for (const p of prompts) {
    const res = await generateStructured(
      { schema: ExtractionSchema, system: EXTRACTION_SYSTEM, user: p.user, modelTier: "fast", task: EXTRACT_TASK },
      { provider, cache },
    );
    inTok += res.usage.inputTokens;
    outTok += res.usage.outputTokens;
    const r = postProcess(res.data, p.refs);
    kept.push(...r.kept);
    for (const [k, n] of Object.entries(r.dropped)) dropped[k] = (dropped[k] ?? 0) + (n ?? 0);
  }

  const eventFor = (q: Quote) =>
    events.find((e) => e.file === q.file && normaliseForQuote(e.text).includes(normaliseForQuote(q.text)));
  const hitIds = new Set(kept.map((k) => k.event.id));
  let hits = 0;
  for (const c of truth.commitments) {
    const e = eventFor(c.quote);
    const ok = Boolean(e && hitIds.has(e.id));
    if (ok) hits++;
    console.log(`${ok ? "FOUND " : "MISSED"} ${c.id}: ${c.quote.text}`);
  }
  const decoyIds = new Set(truth.decoys.map((d) => eventFor(d)?.id).filter(Boolean));
  const falsePositives = kept.filter((k) => decoyIds.has(k.event.id));
  const truthIds = new Set(truth.commitments.map((c) => eventFor(c.quote)?.id));
  const extras = kept.filter((k) => !truthIds.has(k.event.id) && !decoyIds.has(k.event.id));

  console.log(`\nRecall: ${hits}/${truth.commitments.length}. Decoys kept: ${falsePositives.length}. Other items kept: ${extras.length}.`);
  for (const x of extras) console.log(`  extra: "${x.quote}" (${x.owedBy} -> ${x.owedTo})`);
  console.log(`Left out by checks: ${JSON.stringify(dropped)}`);
  const usd = price ? ` (about $${((inTok * price.input + outTok * price.output) / 1e6).toFixed(4)})` : "";
  console.log(`Actual usage: ${inTok} input + ${outTok} output tokens${usd}.`);
}
