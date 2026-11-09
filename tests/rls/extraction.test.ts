import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/hash.ts";
import { MemoryLlmCache } from "../../src/lib/llm/cache-memory.ts";
import { FakeProvider } from "../../src/lib/llm/provider-fake.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { DEMO_WORKSPACE } from "../../src/lib/demo/fixture.ts";
import { fakeExtract } from "../../src/lib/pipeline/fake-extract.ts";
import { PlanError, getRunProgress, planExtraction, runNextJob } from "../../src/lib/pipeline/run-extraction.ts";
import { EXTRACT_TASK } from "../../src/lib/pipeline/tasks.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const ENV = { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" };
const SECRET = "I will submit the hall booking letter to the Dean by Monday.";

async function importAs(c: Client, filename: string, bytes: Uint8Array, level: "committee" | "finance" | "private") {
  const parsed = await parseUpload(filename, bytes);
  const { data, error } = await c.rpc("import_source", {
    p_workspace: WS, p_type: parsed.summary.sourceType, p_filename: filename, p_access: level, p_sha256: sha256Hex(bytes),
    p_summary: parsed.summary,
    p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
    p_reason: "test import",
  });
  if (error) throw new Error(`${filename}: ${error.message}`);
  return data as string;
}

async function runAll(c: Client, runId: string, provider: FakeProvider, cache: MemoryLlmCache) {
  for (let i = 0; i < 100; i++) {
    const step = await runNextJob(c, WS, runId, { provider, cache, env: ENV });
    if (!step) return;
  }
  throw new Error("run did not finish");
}

describe.skipIf(!hasEnv)("extraction pipeline under RLS (fake model)", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  const provider = new FakeProvider({ [EXTRACT_TASK]: fakeExtract });
  const cache = new MemoryLlmCache();
  let runId: string;
  let total: number;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const mini = (f: string) => new Uint8Array(readFileSync(`data/scenarios/mini/${f}`));
    await importAs(as.arun, "whatsapp-committee.txt", mini("whatsapp-committee.txt"), "committee");
    await importAs(as.arun, "minutes.md", mini("minutes.md"), "finance");
    await importAs(as.meena, "WhatsApp Chat with HoD.txt", new TextEncoder().encode(`03/03/2026, 10:00 am - Dr. Meena: ${SECRET}\n03/03/2026, 10:05 am - HoD Office: Noted.`), "private");

    ({ runId, total } = await planExtraction(as.arun, WS, ids.arun));
    await runAll(as.arun, runId, provider, cache);
  });
  afterAll(cleanup);

  it("never sends the model a message the requester cannot read", () => {
    expect(provider.calls.length).toBeGreaterThan(0);
    for (const call of provider.calls) expect(call.user).not.toContain("hall booking letter");
  });

  it("stores commitments with verified quotes at the level of their source", async () => {
    const { data } = await as.meena
      .from("obligations")
      .select("description, owed_by, owed_to, due_text, access_level, trust_state, review_state, evidence(quote, verified, relation)")
      .eq("kind", "commitment")
      .eq("review_state", "draft");
    const certs = data?.find((o) => o.evidence.some((e) => e.quote.includes("participation certificates")));
    expect(certs).toMatchObject({ owed_by: "Arun", access_level: "committee", trust_state: "sourced", review_state: "draft" });
    expect(certs?.evidence[0]).toMatchObject({ verified: true, relation: "supports" });
    const reimburse = data?.find((o) => o.evidence.some((e) => e.quote.startsWith("Divya to reimburse")));
    expect(reimburse?.access_level).toBe("finance");
    expect(data?.some((o) => o.evidence.some((e) => /projector|hackathon/i.test(e.quote)))).toBe(false);
  });

  it("reports progress, and a second run reuses saved answers without duplicating", async () => {
    const p = await getRunProgress(as.arun, WS, runId);
    expect(p).toMatchObject({ total, done: total, failed: 0, pending: 0 });
    expect(p.created).toBeGreaterThanOrEqual(5);

    const callsBefore = provider.calls.length;
    const again = await planExtraction(as.arun, WS, ids.arun);
    await runAll(as.arun, again.runId, provider, cache);
    const p2 = await getRunProgress(as.arun, WS, again.runId);
    expect(p2.created).toBe(0);
    expect(p2.duplicates).toBe(p.created + p.duplicates);
    expect(p2.cachedSteps).toBe(again.total);
    expect(provider.calls.length).toBe(callsBefore);
  });

  it("each role sees only the commitments its level allows", async () => {
    const quotes = async (v: Viewer) =>
      ((await as[v].from("evidence").select("quote")).data ?? []).map((e) => e.quote).join(" | ");
    expect(await quotes("kavya")).toContain("participation certificates");
    expect(await quotes("kavya")).not.toContain("Divya to reimburse");
    expect(await quotes("divya")).toContain("Divya to reimburse");
  });

  it("job payloads hold ids only, never source text", async () => {
    const { data } = await as.arun.from("jobs").select("payload, result").eq("payload->>run_id", runId);
    const blob = JSON.stringify(data);
    expect(blob).not.toContain("certificates");
    expect(blob).not.toContain("Ganesan");
  });

  it("audits each extracted commitment with the reason", async () => {
    const { data } = await as.meena.from("audit_log").select("reason").eq("target_type", "obligations").eq("action", "insert").like("reason", "Extracted%");
    expect((data ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!hasEnv)("add_extracted_commitment and job claiming", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  let eventId: string;
  let meenaDmEvent: string;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const bytes = new TextEncoder().encode("02/03/2026, 7:42 pm - Arun: Sure da, we’ll send the participation certificates by 15 March.\n02/03/2026, 7:45 pm - Priya: ok");
    const src = await importAs(as.arun, "c.txt", bytes, "committee");
    eventId = (await as.arun.from("events").select("id").eq("source_id", src).order("ts").limit(1).single()).data!.id;
    const dm = await importAs(as.meena, "dm.txt", new TextEncoder().encode(`03/03/2026, 10:00 am - Dr. Meena: ${SECRET}`), "private");
    meenaDmEvent = (await as.meena.from("events").select("id").eq("source_id", dm).single()).data!.id;
  });
  afterAll(cleanup);

  const add = (c: Client, event: string, quote: string) =>
    c.rpc("add_extracted_commitment", {
      p_workspace: WS, p_event: event, p_quote: quote, p_owed_by: "Arun", p_owed_to: "Workshop speakers",
      p_deliverable: "Send participation certificates", p_due_text: "by 15 March",
    });

  it("refuses a quote that is not in the cited message, even if the app forgets to check", async () => {
    expect((await add(as.arun, eventId, "we will email the certificates")).error?.message).toMatch(/not a verbatim part/);
    expect((await add(as.arun, eventId, "we")).error?.message).toMatch(/not a verbatim part/);
  });

  it("accepts the same words with straight quotes and odd spacing, once", async () => {
    const first = await add(as.arun, eventId, "we'll  send the participation   certificates");
    expect(first.error).toBeNull();
    expect(first.data?.[0]?.created).toBe(true);
    const again = await add(as.arun, eventId, "WE'LL SEND THE PARTICIPATION CERTIFICATES");
    expect(again.data?.[0]).toMatchObject({ created: false, obligation_id: first.data?.[0]?.obligation_id });
  });

  it("treats a message the caller cannot read as not found, and refuses non-reviewers", async () => {
    expect((await add(as.arun, meenaDmEvent, SECRET)).error?.message).toMatch(/cited message not found/);
    expect((await add(as.kavya, eventId, "we'll send the participation certificates")).error?.message).toMatch(/only the outgoing lead or the advisor/);
  });

  it("only reviewers can plan a run", async () => {
    await expect(planExtraction(as.kavya, WS, ids.kavya)).rejects.toBeInstanceOf(PlanError);
  });

  it("a user can only claim jobs they requested", async () => {
    const { runId } = await planExtraction(as.arun, WS, ids.arun);
    const stolen = await as.meena.rpc("claim_next_job", { p_workspace: WS, p_kind: EXTRACT_TASK, p_run: runId });
    expect(stolen.data).toEqual([]);
    const mine = await as.arun.rpc("claim_next_job", { p_workspace: WS, p_kind: EXTRACT_TASK, p_run: runId });
    expect(mine.data).toHaveLength(1);
    expect(mine.data?.[0]).toMatchObject({ status: "running", attempts: 1 });
  });
});
