// Score the whole pipeline (commitments, recurring duties, follow-up and context, matching and
// trust) on the mini scenario against its ground truth.
//
//   pnpm eval:pipeline                                  # estimate only, no API call
//   pnpm eval:pipeline -- --yes                         # call the real model (costs money)
//   pnpm eval:pipeline -- --yes --model claude-sonnet-5-5   # compare another model
//
// Runs entirely in memory (src/lib/pipeline/run-memory.ts): the same prompts, adapter and
// deterministic checks as the app, never touching the database.

import { modelFor } from "../src/lib/llm/adapter.ts";
import { MemoryLlmCache } from "../src/lib/llm/cache-memory.ts";
import { AnthropicProvider } from "../src/lib/llm/provider-anthropic.ts";
import { istDayKey } from "../src/lib/format.ts";
import { DUTY_SYSTEM, batchDutyEvents, buildDutyPrompt, dutyCandidates } from "../src/lib/pipeline/cycles.ts";
import { EXTRACTION_SYSTEM, buildExtractionPrompt, chunkEvents } from "../src/lib/pipeline/extract.ts";
import { FOLLOWUP_SYSTEM, buildFollowupPrompt } from "../src/lib/pipeline/fulfilment.ts";
import { buildIdf, relatedEvents } from "../src/lib/pipeline/related.ts";
import { runInMemory } from "../src/lib/pipeline/run-memory.ts";
import { normaliseForQuote } from "../src/lib/pipeline/verify.ts";
import { eventFor, miniEvents, miniTruth } from "./mini-scenario.ts";

// Prices per million tokens (Claude API, cached 2026-10-06). Used for estimates only.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const env = { ...process.env, ...(arg("--model") ? { LLM_MODEL_FAST: arg("--model") } : {}) };
const model = modelFor("fast", env);
const price = PRICES[model];

const truth = miniTruth();
const events = await miniEvents();

// Estimate: extraction and duty prompts are known; follow-ups use the ground-truth items as targets.
const tokens = (s: string) => Math.ceil(s.length / 3.5);
const extraction = chunkEvents(events).map((c) => tokens(EXTRACTION_SYSTEM + buildExtractionPrompt(c).user));
const duties = batchDutyEvents(dutyCandidates(events)).map((b) => tokens(DUTY_SYSTEM + buildDutyPrompt(b).user));
const idf = buildIdf(events);
const followups = truth.commitments.map((c) => {
  const src = eventFor(events, c.quote)!;
  const target = { obligationId: "x", kind: "commitment" as const, description: c.deliverable, owedBy: c.owedBy, owedTo: c.owedTo, dueText: null, cadence: null, approver: null, sourceEventIds: [src.id], sourceQuotes: [c.quote.text] };
  return tokens(FOLLOWUP_SYSTEM + buildFollowupPrompt(target, relatedEvents({ text: `${c.deliverable} ${c.quote.text}`, sourceEventIds: [src.id] }, events, idf)).user);
});
// Matching: about one call per eight uncertain pairs; with ~10 items, allow two calls of ~2,000 tokens.
const matchCalls = 2;
const calls = extraction.length + duties.length + followups.length + truth.recurring.length * 2 + matchCalls;
const estIn = [...extraction, ...duties, ...followups, ...followups.slice(0, truth.recurring.length * 2)].reduce((a, b) => a + b, 0) + matchCalls * 2000;
const estOut = calls * 1500; // generous: the answer plus low-effort thinking
console.log(`Mini scenario: ${events.length} messages, about ${calls} model calls on ${model} (commitments ${extraction.length}, duties ${duties.length}, follow-ups about ${calls - extraction.length - duties.length - matchCalls}, matching about ${matchCalls}).`);
if (price) console.log(`Estimate: about ${estIn} input + ${estOut} output tokens, about $${((estIn * price.input + estOut * price.output) / 1e6).toFixed(4)}.`);

if (!process.argv.includes("--yes")) {
  console.log("Dry run only. Re-run with -- --yes to call the model.");
} else {
  const res = await runInMemory(events, { provider: new AnthropicProvider(), cache: new MemoryLlmCache(), env, today: istDayKey(new Date().toISOString()) });
  const idOf = (q: { file: string; text: string }) => eventFor(events, q)?.id;

  console.log("\nCommitments and their status");
  let found = 0;
  let statusOk = 0;
  let trustOk = 0;
  let evHit = 0;
  let evTotal = 0;
  for (const c of truth.commitments) {
    const got = res.commitments.find((k) => k.candidate.event.id === idOf(c.quote));
    if (got) found++;
    if (got?.status === c.expectedStatus) statusOk++;
    if (got?.trust === c.expectedTrust) trustOk++;
    console.log(`${got ? "FOUND " : "MISSED"} ${c.id}: expected ${c.expectedStatus}, got ${got?.status ?? "-"}${got && got.status !== c.expectedStatus ? "   <-- wrong" : ""} | trust: expected ${c.expectedTrust}, got ${got?.trust ?? "-"}${got && got.trust !== c.expectedTrust ? "   <-- wrong" : ""}`);
    for (const e of c.evidence) {
      evTotal++;
      const hit = got?.evidence.some((k) => k.relation === e.relation && k.event.id === idOf(e));
      if (hit) evHit++;
      console.log(`         ${hit ? "has " : "LACKS"} ${e.relation}: ${e.text}`);
    }
    for (const k of got?.evidence ?? []) {
      if (!c.evidence.some((e) => e.relation === k.relation && idOf(e) === k.event.id)) console.log(`         extra ${k.relation}${k.inferred ? " (inferred)" : ""}: "${k.quote}"`);
    }
    for (const x of got?.context ?? []) console.log(`         context ${x.kind}: ${x.note}  ["${x.quote}"]`);
  }
  const x1 = res.commitments.find((k) => k.candidate.event.id === idOf(truth.commitments.find((c) => c.id === truth.contradictions[0].commitment)!.quote));
  const x1ok = Boolean(x1?.evidence.some((e) => e.relation === "fulfils") && x1?.evidence.some((e) => e.relation === "contradicts"));

  const decoys = new Set(truth.decoys.map(idOf));
  const truthIds = new Set(truth.commitments.map((c) => idOf(c.quote)));
  const extras = res.commitments.filter((k) => !truthIds.has(k.candidate.event.id));
  for (const x of extras) console.log(`  extra commitment${decoys.has(x.candidate.event.id) ? " (DECOY)" : ""}: "${x.candidate.quote}" -> ${x.status}`);

  console.log("\nRecurring duties");
  let dutiesFound = 0;
  let approverOk = 0;
  let dutyTrustOk = 0;
  const matched = new Set<number>();
  for (const r of truth.recurring) {
    const ids = new Set(r.quotes.map(idOf));
    // The committee-level copy (a finance copy from the minutes may exist too, linked to it).
    const at = (pred: (d: (typeof res.duties)[number]) => boolean) => res.duties.findIndex((d) => d.duty.quotes.some((q) => ids.has(q.event.id)) && pred(d));
    const i = at((d) => d.level === "committee") >= 0 ? at((d) => d.level === "committee") : at(() => true);
    const d = res.duties[i];
    if (d) {
      dutiesFound++;
      matched.add(i);
    }
    const ap = d?.duty.approver ? normaliseForQuote(r.approver).includes(normaliseForQuote(d.duty.approver)) || normaliseForQuote(d.duty.approver).includes(normaliseForQuote(r.approver)) : false;
    if (ap) approverOk++;
    if (d?.trust === r.expectedTrust) dutyTrustOk++;
    console.log(`${d ? "FOUND " : "MISSED"} ${r.id}: ${d ? `"${d.duty.description}" | ${d.duty.period} ("${d.duty.cadence}") | approval: ${d.duty.approval ?? "-"} from ${d.duty.approver ?? "-"}${ap ? "" : "  <-- approver"} | lead: ${d.duty.leadTime ?? "-"} | next due: ${d.schedule.nextDue ?? "-"} | ${d.duty.quotes.length} quote(s), level ${d.level} | trust: expected ${r.expectedTrust}, got ${d.trust}${d.trust !== r.expectedTrust ? "   <-- wrong" : ""}` : r.duty}`);
    for (const x of d?.context ?? []) console.log(`         context ${x.kind}: ${x.note}  ["${x.quote}"]`);
  }
  res.duties.forEach((d, i) => {
    if (!matched.has(i)) console.log(`  extra duty: "${d.duty.description}" (${d.duty.period}, level ${d.level}, ${d.duty.quotes.length} quote(s), trust ${d.trust})`);
  });

  console.log("\nLinks between items");
  const label = (id: string) => {
    const c = res.commitments.find((x) => x.id === id);
    if (c) return `${truth.commitments.find((t) => idOf(t.quote) === c.candidate.event.id)?.id ?? "extra"} "${c.candidate.deliverable}" (${c.level})`;
    const d = res.duties.find((x) => x.id === id);
    return `${truth.recurring.find((t) => d?.duty.quotes.some((q) => t.quotes.some((tq) => idOf(tq) === q.event.id)))?.id ?? "extra"} duty "${d?.duty.description}" (${d?.level})`;
  };
  // Two different ground-truth commitments must never be linked.
  const truthOf = (id: string) => truth.commitments.find((t) => idOf(t.quote) === res.commitments.find((x) => x.id === id)?.candidate.event.id)?.id;
  let wrongLinks = 0;
  for (const l of res.links) {
    const ta = truthOf(l.a);
    const tb = truthOf(l.b);
    const wrong = Boolean(ta && tb && ta !== tb && l.verdict === "same");
    if (wrong) wrongLinks++;
    console.log(`  ${l.verdict} (${l.method}): ${label(l.a)}  <->  ${label(l.b)}${wrong ? "   <-- WRONG" : ""}`);
  }
  if (res.links.length === 0) console.log("  none");

  console.log(`\nCommitments found: ${found}/${truth.commitments.length}. Decoys kept: ${extras.filter((x) => decoys.has(x.candidate.event.id)).length}. Other commitments: ${extras.length - extras.filter((x) => decoys.has(x.candidate.event.id)).length}.`);
  console.log(`Status correct: ${statusOk}/${truth.commitments.length}. Follow-up evidence found: ${evHit}/${evTotal}. Contradiction X1 detected: ${x1ok ? "yes" : "no"}.`);
  console.log(`Recurring duties found: ${dutiesFound}/${truth.recurring.length}, approver right: ${approverOk}/${truth.recurring.length}. Extra duties: ${res.duties.length - matched.size}.`);
  console.log(`Trust correct: commitments ${trustOk}/${truth.commitments.length}, duties ${dutyTrustOk}/${truth.recurring.length}. Links: ${res.links.filter((l) => l.verdict === "same").length} same, ${res.links.filter((l) => l.verdict === "possible").length} possible, ${wrongLinks} wrong.`);
  console.log(`Left out by checks: ${JSON.stringify(res.dropped)}`);
  const usd = price ? ` (about $${((res.usage.inputTokens * price.input + res.usage.outputTokens * price.output) / 1e6).toFixed(4)})` : "";
  console.log(`Actual usage: ${res.calls} calls, ${res.usage.inputTokens} input + ${res.usage.outputTokens} output tokens${usd}.`);
}
