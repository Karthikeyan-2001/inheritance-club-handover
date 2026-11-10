// Build a generated scenario's ledger through the app's own pipeline, on LOCAL Supabase, and
// freeze the result for visitors' demo copies (SYNTHETIC data only).
//
//   pnpm demo:freeze -- --scenario year              # estimate only, no model call
//   pnpm demo:freeze -- --scenario year --yes        # build with the real model, score, write the JSON
//   pnpm demo:freeze -- --scenario photo --yes --no-write   # build only: fills the local model cache
//
// Each file is imported by its own uploader at its own level (import_source, through RLS), the
// ledger is built by the outgoing lead and then by the advisor (as the leak test does), with the
// Anthropic provider and the local `llm_cache`. The result is scored against the scenario's
// ground truth with the same scorer as `pnpm eval:pipeline`. Items that match a planted item
// are frozen as accepted (version 1 of the handover); the rest stay drafts for a visitor to
// review. Never runs against a hosted project.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccessLevel } from "../src/lib/access.ts";
import { DEMO_USERS, type DemoUserKey } from "../src/lib/demo/demo-users.ts";
import type { FrozenClub, FrozenObligation } from "../src/lib/demo/frozen-club.ts";
import { eventFor, loadScenario, type ScenarioEvent } from "../src/lib/eval/scenario.ts";
import { formatScorecard, scoreRun } from "../src/lib/eval/score.ts";
import { sha256Hex } from "../src/lib/hash.ts";
import { modelFor } from "../src/lib/llm/adapter.ts";
import { SupabaseLlmCache } from "../src/lib/llm/cache-supabase.ts";
import { MemoryLlmCache } from "../src/lib/llm/cache-memory.ts";
import { AnthropicProvider } from "../src/lib/llm/provider-anthropic.ts";
import { FakeProvider } from "../src/lib/llm/provider-fake.ts";
import { parseUpload } from "../src/lib/parsers/index.ts";
import type { Period } from "../src/lib/pipeline/cycles.ts";
import { fakeHandlers } from "../src/lib/pipeline/provider.ts";
import type { MemoryResult } from "../src/lib/pipeline/run-memory.ts";
import { runInMemory } from "../src/lib/pipeline/run-memory.ts";
import { getRunProgress, planRun, runNextStep } from "../src/lib/pipeline/run-pipeline.ts";
import type { Database, Json } from "../src/lib/supabase/database.types.ts";
import { loadWorld } from "../src/lib/synth/world.ts";
import { isLocalUrl, readSeedEnv } from "./seed.ts";

type Db = SupabaseClient<Database>;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const scenarioName = arg("--scenario") ?? "year";
const yes = process.argv.includes("--yes");
const write = !process.argv.includes("--no-write");
// The day the ledger's dates are computed for: the handover, at the end of the scenario's year.
const TODAY = arg("--today") ?? "2026-11-10";
const OUT = `src/lib/demo/${scenarioName}-club.json`;
// One fixed scratch workspace per scenario, replaced on every run.
const WS = `f0000000-0000-4000-8000-${sha256Hex(scenarioName).slice(0, 12)}`;

// Haiku 5.5 per million tokens (cached 2026-10-06), and the Phase 12 calibration (eval-pipeline.ts).
const PRICE = { input: 0.1, output: 0.5 };
const usd = (i: number, o: number) => `about $${((i * PRICE.input + o * PRICE.output) / 1e6).toFixed(4)}`;

function must<T>(label: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

const env = readSeedEnv();
if (!isLocalUrl(env.url)) throw new Error(`Refusing to run against ${new URL(env.url).host}: this script is for local Supabase only.`);
const scenario = await loadScenario(scenarioName);
const model = modelFor("fast", process.env);
console.log(`Scenario "${scenarioName}" (SYNTHETIC): ${scenario.events.length} messages in ${scenario.files.length} files. Model: ${model}.`);

// Estimate first, from the same prompts walked with the offline fake (as eval-pipeline.ts does).
// The database path runs twice (outgoing lead, then advisor); the advisor's run reuses every
// cached prompt, so it costs only what the outgoing lead could not read.
{
  const dry = new FakeProvider(fakeHandlers());
  await runInMemory(scenario.events, { provider: dry, cache: new MemoryLlmCache(), env: { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" }, today: TODAY });
  const input = dry.calls.reduce((n, c) => n + Math.ceil(Math.ceil((c.system + c.user).length / 3.5) * 1.3) + 1500, 0);
  const output = dry.calls.length * 800;
  console.log(`Estimate: about ${dry.calls.length} model calls, ${input} input + ${output} output tokens, ${usd(input, output)} (errs high; repeated prompts are cached).`);
}
if (!yes) {
  console.log("Estimate only. Re-run with -- --yes to call the model.");
  process.exit(0);
}

const admin: Db = createClient<Database>(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) throw new Error(listErr.message);
const users = {} as Record<DemoUserKey, string>;
for (const u of DEMO_USERS) {
  const found = list.users.find((x) => x.email === u.email);
  if (!found) throw new Error(`Demo user ${u.email} is missing. Run pnpm seed first.`);
  users[u.key] = found.id;
}
const keyOfUser = new Map(Object.entries(users).map(([k, id]) => [id, k as DemoUserKey]));

const signIn = async (key: DemoUserKey): Promise<Db> => {
  const c = createClient<Database>(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = DEMO_USERS.find((u) => u.key === key)!;
  const r = await c.auth.signInWithPassword({ email: user.email, password: env.demoPassword });
  if (r.error) throw new Error(`sign in ${key}: ${r.error.message}`);
  return c;
};
const as = { arun: await signIn("arun"), meena: await signIn("meena") } as Record<"arun" | "meena", Db> & Partial<Record<DemoUserKey, Db>>;

// A fresh scratch workspace with the four shared demo accounts.
if (must("find", await admin.from("workspaces").select("id").eq("id", WS))?.length) {
  must("delete", await admin.rpc("delete_workspace", { p_workspace: WS, p_reason: "freeze-demo: rebuild" }));
}
must("workspace", await admin.from("workspaces").insert({ id: WS, name: `Freeze: ${scenarioName} (SYNTHETIC)`, created_by: users.arun, is_demo: false }));
must("memberships", await admin.from("memberships").insert([
  { workspace_id: WS, user_id: users.arun, role: "outgoing_lead" }, { workspace_id: WS, user_id: users.meena, role: "advisor" },
  { workspace_id: WS, user_id: users.kavya, role: "incoming_lead" }, { workspace_id: WS, user_id: users.divya, role: "treasurer" },
]));

// Aliases: the world's people and their nicknames, so matching knows "Aru" is Arun.
const worldPath = `data/scenarios/${scenarioName}/world.yaml`;
const aliases: FrozenClub["aliases"] = existsSync(worldPath)
  ? loadWorld(readFileSync(worldPath, "utf8")).people
      .map((p) => ({ canonical: p.name, variants: p.nicknames.filter((n) => n !== p.name), kind: "person" as const }))
      .filter((a) => a.variants.length > 0)
  : [];
if (aliases.length) must("aliases", await admin.from("aliases").insert(aliases.map((a) => ({ workspace_id: WS, ...a }))));

// Import every file as its uploader, at its level.
const summaries = new Map<string, NonNullable<Json>>();
for (const f of scenario.files) {
  const client = as[f.uploader as "arun" | "meena"] ?? (as[f.uploader] = await signIn(f.uploader));
  const parsed = await parseUpload(f.name, f.bytes);
  summaries.set(f.name, parsed.summary as unknown as NonNullable<Json>);
  must(`import ${f.name}`, await client.rpc("import_source", {
    p_workspace: WS, p_type: parsed.summary.sourceType, p_filename: f.name, p_access: f.accessLevel, p_sha256: sha256Hex(f.bytes),
    p_summary: parsed.summary, p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
    p_reason: "Synthetic scenario imported for the demo freeze",
  }));
}
console.log(`Imported ${scenario.files.length} files.`);

// Build: the outgoing lead, then the advisor (who reads everything).
const usage = { input: 0, output: 0, calls: 0, cached: 0 };
const dropped: Record<string, number> = {};
for (const v of ["arun", "meena"] as const) {
  const { runId, total } = await planRun(as[v], WS, users[v]);
  const deps = { provider: new AnthropicProvider(), cache: new SupabaseLlmCache(), env: process.env, today: TODAY };
  let steps = 0;
  for (let step = await runNextStep(as[v], WS, runId, users[v], deps); step; step = await runNextStep(as[v], WS, runId, users[v], deps)) {
    steps++;
    if (step.error) console.log(`  ${step.kind} ${step.chunk}/${step.of}: ${step.error.code}: ${step.error.message}`);
    if (step.model) {
      usage.calls++;
      if (step.cached) usage.cached++;
      else {
        usage.input += step.usage.inputTokens;
        usage.output += step.usage.outputTokens;
      }
    }
    for (const [k, n] of Object.entries(step.dropped ?? {})) dropped[k] = (dropped[k] ?? 0) + n;
    if (steps % 10 === 0) console.log(`  ${v}: ${steps} steps (planned ${total} to start), ${usage.calls} calls so far, ${usd(usage.input, usage.output)}`);
  }
  const p = await getRunProgress(as[v], WS, runId);
  if (p.pending || p.failed) throw new Error(`${v}'s run did not finish cleanly: pending ${p.pending}, failed ${p.failed}`);
  console.log(`${v}'s run: ${steps} steps.`);
}
console.log(`Model: ${usage.calls} calls (${usage.cached} cached), ${usage.input} input + ${usage.output} output tokens, ${usd(usage.input, usage.output)}.`);

// Read back everything the build made.
const sources = must("sources", await admin.from("sources").select("id, type, filename, access_level, uploaded_by, sha256").eq("workspace_id", WS).order("imported_at"));
const refOf = new Map<string, string>();
const frozenSources: FrozenClub["sources"] = [];
for (const s of sources ?? []) {
  const rows: Database["public"]["Tables"]["events"]["Row"][] = [];
  for (let from = 0; ; from += 1000) {
    const page = must("events", await admin.from("events").select("*").eq("source_id", s.id).order("seq").range(from, from + 999));
    rows.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  rows.forEach((e, i) => refOf.set(e.id, `${s.filename}#${i}`));
  frozenSources.push({
    key: s.filename, type: s.type, filename: s.filename, access_level: s.access_level, uploadedBy: keyOfUser.get(s.uploaded_by ?? "") ?? "arun",
    sha256: s.sha256 ?? "", read_summary: summaries.get(s.filename) ?? {},
    events: rows.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.thread_id, meta: e.meta ?? {} })),
  });
}
const ref = (eventId: string) => {
  const r = refOf.get(eventId);
  if (!r) throw new Error(`event ${eventId} is not in this workspace`);
  return r as `${string}#${number}`;
};

const obligations = must("obligations", await admin.from("obligations").select("*").eq("workspace_id", WS).order("created_at").order("id")) ?? [];
const obIds = obligations.map((o) => o.id);
const evidence = must("evidence", await admin.from("evidence").select("*").in("obligation_id", obIds)) ?? [];
const context = must("context", await admin.from("context_items").select("*").in("obligation_id", obIds).order("created_at")) ?? [];
const links = must("links", await admin.from("obligation_links").select("*").eq("workspace_id", WS)) ?? [];
const docket = must("docket", await admin.from("docket_entries").select("*").eq("workspace_id", WS)) ?? [];
const keyOf = new Map(obligations.map((o, i) => [o.id, `${o.kind === "commitment" ? "C" : "R"}${i + 1}`]));

// The same scorecard as the in-memory eval, from what the database holds.
const byRef = new Map<string, ScenarioEvent>(scenario.events.map((e) => [e.id, e]));
const eventOf = (id: string) => byRef.get(ref(id))!;
const evOf = (id: string) => evidence.filter((e) => e.obligation_id === id && e.verified);
const ctxOf = (id: string) => context.filter((c) => c.obligation_id === id && c.event_id && c.quote).map((c) => ({ event: eventOf(c.event_id!), quote: c.quote!, kind: c.kind, note: c.text }));
const result: MemoryResult = {
  commitments: obligations.filter((o) => o.kind === "commitment").map((o) => {
    const src = evOf(o.id).find((e) => e.relation === "supports")!;
    return {
      id: o.id, level: o.access_level, trust: o.trust_state, status: o.status as MemoryResult["commitments"][number]["status"],
      candidate: { event: eventOf(src.event_id), quote: src.quote, owedBy: o.owed_by ?? "", owedTo: o.owed_to ?? "", deliverable: o.description, dueText: o.due_text },
      evidence: evOf(o.id).filter((e) => e.relation === "fulfils" || e.relation === "contradicts").map((e) => ({ event: eventOf(e.event_id), quote: e.quote, relation: e.relation as "fulfils" | "contradicts", inferred: e.inferred })),
      context: ctxOf(o.id),
    };
  }),
  duties: obligations.filter((o) => o.kind === "recurring").map((o) => ({
    id: o.id, level: o.access_level, trust: o.trust_state,
    duty: {
      description: o.description, period: (o.period ?? "year") as Period, cadence: o.cadence ?? "", approval: o.approval_required, approver: o.approver,
      leadTime: o.lead_time, whenWords: null, owedBy: o.owed_by,
      quotes: evOf(o.id).filter((e) => e.relation === "supports" || e.relation === "past_instance").map((e) => ({ event: eventOf(e.event_id), quote: e.quote, relation: e.relation as "supports" | "past_instance" })),
    },
    schedule: { nextDue: o.next_due, startBy: o.start_by, basis: o.next_due_basis },
    context: ctxOf(o.id),
  })),
  links: links.map((l) => ({ a: l.a, b: l.b, verdict: l.verdict as "same" | "possible", method: l.method as "rule" | "model" })),
  dropped, usage: { inputTokens: usage.input, outputTokens: usage.output }, calls: usage.calls,
};
const card = scoreRun(result, scenario);
console.log("\n" + formatScorecard(card));

// The scratch workspace makes the shared demo accounts members of a second club, and the app
// signs an account in to its first membership. Remove it once read; the answers stay cached.
async function dropScratch() {
  must("drop scratch workspace", await admin.rpc("delete_workspace", { p_workspace: WS, p_reason: "freeze-demo: done" }));
}

if (!write) {
  await dropScratch();
  console.log("\n--no-write: nothing written. The local llm_cache now holds this scenario's answers.");
  process.exit(0);
}

// Review decisions for version 1: planted items (and their restatements and copies) are
// accepted; anything else stays a draft, for the visitor to accept or reject.
const planted = new Set<string>([
  ...card.commitments.rows.map((r) => r.itemId).filter((x): x is string => Boolean(x)),
  ...card.extras.rows.filter((x) => x.kind === "restatement").map((x) => x.itemId),
  ...card.duties.rows.map((r) => r.itemId).filter((x): x is string => Boolean(x)),
  // A duty's copy at a more restricted level (the finance minutes restating a committee rule).
  ...result.duties.filter((d) => scenario.truth.recurring.some((r) => d.duty.quotes.some((q) => r.quotes.some((t) => q.event.id === eventFor(scenario.events, t)?.id)))).map((d) => d.id),
]);

const frozenObligations: FrozenObligation[] = obligations.map((o) => ({
  key: keyOf.get(o.id)!, kind: o.kind, description: o.description, owed_by: o.owed_by, owed_to: o.owed_to, due_text: o.due_text,
  due_date: o.due_date, next_due: o.next_due, approval_required: o.approval_required, approver: o.approver, status: o.status,
  access_level: o.access_level as AccessLevel, private_uploaders: (o.private_uploaders ?? []).map((u) => keyOfUser.get(u)).filter((k): k is DemoUserKey => Boolean(k)),
  review_state: planted.has(o.id) ? "accepted" : "draft", fulfilment_checked_at: o.fulfilment_checked_at, period: o.period, cadence: o.cadence,
  lead_time: o.lead_time, start_by: o.start_by, next_due_basis: o.next_due_basis,
}));

// Sealed placeholders: one for a finance item and one for a private item, if the build made them.
// Topics are fixed words, never model text, and name no detail.
const sealed: FrozenClub["sealed"] = [];
const firstAt = (level: AccessLevel) => frozenObligations.find((o) => o.review_state === "accepted" && obligations.find((x) => keyOf.get(x.id) === o.key)!.access_level === level);
const fin = firstAt("finance");
if (fin) sealed.push({ obligation: fin.key, holder_role: "treasurer", topic_label: "A finance matter", approvedBy: "meena" });
const priv = firstAt("private");
if (priv) sealed.push({ obligation: priv.key, holder_role: "advisor", topic_label: "A private matter, held by the advisor", approvedBy: "meena" });

const club: FrozenClub = {
  synthetic: true,
  name: scenarioName === "year" ? "IoT Club, one year (SYNTHETIC)" : `${scenarioName} club (SYNTHETIC)`,
  built: {
    scenario: scenarioName, model, builtOn: new Date().toISOString().slice(0, 10), today: TODAY, calls: usage.calls,
    note: "Built once by scripts/freeze-demo.ts through the app's own pipeline on synthetic data; loaded into demo copies without a model call.",
  },
  sources: frozenSources,
  obligations: frozenObligations,
  evidence: evidence.filter((e) => e.verified).map((e) => ({ obligation: keyOf.get(e.obligation_id)!, event: ref(e.event_id), quote: e.quote, relation: e.relation, inferred: e.inferred }))
    .sort((a, b) => a.obligation.localeCompare(b.obligation, undefined, { numeric: true }) || a.event.localeCompare(b.event, undefined, { numeric: true })),
  context: context.filter((c) => c.verified && c.event_id && c.quote).map((c) => ({ obligation: keyOf.get(c.obligation_id)!, event: ref(c.event_id!), kind: c.kind, text: c.text, quote: c.quote! })),
  links: links.map((l) => ({ a: keyOf.get(l.a)!, b: keyOf.get(l.b)!, verdict: l.verdict as "same" | "possible", method: l.method as "rule" | "model", score: l.score })),
  docket: docket.filter((d) => d.obligation_id).map((d) => ({ obligation: keyOf.get(d.obligation_id!)!, claimA: ref(d.claim_a_event), claimB: ref(d.claim_b_event), summary: d.summary })),
  aliases,
  sealed,
};
writeFileSync(OUT, JSON.stringify(club, null, 1) + "\n");
await dropScratch();
console.log(`\nWrote ${OUT}: ${club.obligations.length} items (${club.obligations.filter((o) => o.review_state === "accepted").length} accepted), ${club.evidence.length} quotes, ${club.context.length} notes, ${club.links.length} links, ${sealed.length} sealed.`);
