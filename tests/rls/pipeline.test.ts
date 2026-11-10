import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/hash.ts";
import { MemoryLlmCache } from "../../src/lib/llm/cache-memory.ts";
import { FakeProvider } from "../../src/lib/llm/provider-fake.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { DEMO_WORKSPACE } from "../../src/lib/demo/fixture.ts";
import type { Json } from "../../src/lib/supabase/database.types.ts";
import { fakeHandlers } from "../../src/lib/pipeline/provider.ts";
import { PlanError, getRunProgress, planRun, runNextStep } from "../../src/lib/pipeline/run-pipeline.ts";
import { EXTRACT_TASK } from "../../src/lib/pipeline/tasks.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const ENV = { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" };
const SECRET = "I will submit the hall booking letter to the Dean by Monday.";
const ARUN_NOTE = "Bala sir said the ESP32 boards go back after the audit.";

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

const mini = (f: string) => new Uint8Array(readFileSync(`data/scenarios/mini/${f}`));
const chat = (lines: string[]) => new TextEncoder().encode(lines.join("\n"));

async function runAll(c: Client, runId: string, userId: string, provider: FakeProvider, cache: MemoryLlmCache) {
  for (let i = 0; i < 200; i++) {
    const step = await runNextStep(c, WS, runId, userId, { provider, cache, env: ENV, today: "2026-11-09" });
    if (!step) return;
  }
  throw new Error("run did not finish");
}

type Row = { description: string; status: string; access_level: string; fulfilment_checked_at: string | null; evidence: { quote: string; relation: string; inferred: boolean; verified: boolean }[] };
const findBy = (rows: Row[] | null, quote: string) => rows?.find((o) => o.evidence.some((e) => e.relation === "supports" && e.quote.includes(quote)));

describe.skipIf(!hasEnv)("the staged pipeline under RLS (fake model)", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  const provider = new FakeProvider(fakeHandlers());
  const cache = new MemoryLlmCache();
  let runId: string;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    await importAs(as.arun, "whatsapp-committee.txt", mini("whatsapp-committee.txt"), "committee");
    await importAs(as.arun, "trello-board.json", mini("trello-board.json"), "committee");
    await importAs(as.arun, "minutes.md", mini("minutes.md"), "finance");
    await importAs(as.meena, "WhatsApp Chat with HoD.txt", chat([`03/03/2026, 10:00 am - Dr. Meena: ${SECRET}`, "03/03/2026, 10:05 am - HoD Office: Noted."]), "private");
    await importAs(as.arun, "WhatsApp Chat with Bala sir.txt", chat([`24/02/2026, 9:00 am - Arun: ${ARUN_NOTE}`, "24/02/2026, 9:05 am - Bala sir: Yes"]), "private");

    ({ runId } = await planRun(as.arun, WS, ids.arun));
    await runAll(as.arun, runId, ids.arun, provider, cache);
  });
  afterAll(cleanup);

  it("runs every stage in order and reports progress", async () => {
    const p = await getRunProgress(as.arun, WS, runId);
    expect(p).toMatchObject({ failed: 0, pending: 0 });
    expect(p.done).toBe(p.total);
    expect(p.stages.extract_commitments.created).toBeGreaterThanOrEqual(5);
    expect(p.stages.find_duties.created).toBeGreaterThanOrEqual(2);
    expect(p.stages.plan_followups.done).toBe(1);
    expect(p.stages.check_followup.total).toBeGreaterThanOrEqual(7);
    expect(p.followup.statuses.contradicted).toBeGreaterThanOrEqual(1);

    const { data } = await as.arun.from("jobs").select("kind, payload, finished_at").eq("payload->>run_id", runId).order("finished_at");
    const stages = (data ?? []).map((j) => (j.payload as { stage: number }).stage);
    expect([...stages].sort()).toEqual(stages);
  });

  it("links the Trello card to the chat promise it restates, and settles trust from both", async () => {
    const p = await getRunProgress(as.arun, WS, runId);
    expect(p.stages.plan_matches.done).toBe(1);
    expect(p.matching.same).toBeGreaterThanOrEqual(2);

    const { data: items } = await as.arun
      .from("obligations")
      .select("id, kind, trust_state, status, evidence(quote, relation)")
      .eq("review_state", "draft");
    const by = (quote: string) => items?.find((o) => o.evidence.some((e) => e.relation === "supports" && e.quote.includes(quote)));
    const chatCerts = by("participation certificates");
    const cardCerts = by("Card: Send certificates");
    const { data: links } = await as.arun.from("obligation_links").select("a, b, verdict, method");
    const linked = (x?: { id: string }, y?: { id: string }) =>
      links?.find((l) => x && y && [l.a, l.b].sort().join() === [x.id, y.id].sort().join());
    expect(linked(chatCerts, cardCerts)).toMatchObject({ verdict: "same" });
    expect(linked(by("fest posters printed"), by("Card: Print fest posters"))).toMatchObject({ verdict: "same" });

    // Rule B: a second record from another file or person corroborates; one person repeating themselves does not.
    expect(chatCerts).toMatchObject({ trust_state: "contradicted", status: "contradicted" });
    expect(cardCerts).toMatchObject({ trust_state: "contradicted" });
    expect(by("fest posters printed")).toMatchObject({ trust_state: "corroborated", status: "fulfilled" });
    expect(by("ESP32 boards")).toMatchObject({ trust_state: "sourced", status: "fulfilled" });
    expect(by("Brightwave Labs")).toMatchObject({ trust_state: "sourced", status: "no_evidence" });
  });

  it("shows each role only the links and docket entries whose items it can read", async () => {
    const readable = async (v: Viewer) => new Set(((await as[v].from("obligations").select("id")).data ?? []).map((o) => o.id));
    for (const v of ["arun", "divya", "kavya", "member"] as const) {
      const ids = await readable(v);
      const { data: links } = await as[v].from("obligation_links").select("a, b");
      for (const l of links ?? []) expect(ids.has(l.a) && ids.has(l.b), v).toBe(true);
      const { data: docket } = await as[v].from("docket_entries").select("obligation_id");
      for (const d of docket ?? []) expect(d.obligation_id === null || ids.has(d.obligation_id), v).toBe(true);
    }
    const { data } = await as.arun.from("docket_entries").select("quote_b").not("obligation_id", "is", null);
    expect(data?.some((d) => d.quote_b?.includes("not received") || d.quote_b?.includes("nobody has sent"))).toBe(true);
    expect((await as.member.from("docket_entries").select("id")).data).toEqual([]);
  });

  it("never sends the model a message the requester cannot read", () => {
    expect(provider.calls.length).toBeGreaterThan(0);
    for (const call of provider.calls) expect(call.user).not.toContain("hall booking letter");
  });

  it("derives each commitment's status from verified follow-up evidence", async () => {
    const { data } = await as.arun
      .from("obligations")
      .select("description, status, access_level, fulfilment_checked_at, evidence(quote, relation, inferred, verified)")
      .eq("kind", "commitment")
      .eq("review_state", "draft");
    const rows = data as Row[] | null;
    const certs = findBy(rows, "participation certificates");
    expect(certs).toMatchObject({ status: "contradicted", access_level: "committee" });
    expect(certs?.evidence.some((e) => e.relation === "fulfils" && e.quote.startsWith("Moved card"))).toBe(true);
    expect(certs?.evidence.some((e) => e.relation === "contradicts" && e.quote.includes("nobody has sent them yet"))).toBe(true);
    expect(findBy(rows, "ESP32 boards")?.status).toBe("fulfilled");
    expect(findBy(rows, "fest posters")?.status).toBe("fulfilled");
    const sponsor = findBy(rows, "Brightwave Labs");
    expect(sponsor).toMatchObject({ status: "no_evidence" });
    expect(sponsor?.fulfilment_checked_at).not.toBeNull();
    for (const o of rows ?? []) expect(o.evidence.every((e) => e.verified)).toBe(true);
  });

  it("stores recurring duties with their approvers at the level of their quotes", async () => {
    const { data } = await as.arun
      .from("obligations")
      .select("description, approver, period, cadence, lead_time, access_level, evidence(quote, relation)")
      .eq("kind", "recurring")
      .eq("review_state", "draft");
    // The lab rule is in the demo fixture (everyone) and the mini files (committee); the finance copy is left out here.
    const lab = (data?.filter((o) => o.approver === "HoD") ?? []).filter((o) => o.access_level !== "finance");
    expect(lab.length).toBeGreaterThanOrEqual(1);
    for (const o of lab) expect(["everyone", "committee"]).toContain(o.access_level);
    expect(lab.some((o) => o.period === "semester")).toBe(true);
    const fest = data?.find((o) => o.approver === "Dean's office");
    expect(fest).toMatchObject({ access_level: "committee", period: "year", lead_time: "a month ahead" });
    // The minutes (finance) never feed a committee-level duty.
    for (const o of data ?? []) if (o.access_level !== "finance") for (const e of o.evidence) expect(e.quote).not.toMatch(/^A signed HoD permission letter/);
  });

  it("gives each context note the level of its own message", async () => {
    const ctx = async (v: Viewer) => ((await as[v].from("context_items").select("text, quote, access_level, verified")).data ?? []);
    const arun = await ctx("arun");
    expect(arun.find((c) => c.verified && c.quote?.includes("bills"))).toMatchObject({ access_level: "finance" });
    // Arun's own private file: he and the advisor see the note; nobody else does.
    expect(arun.some((c) => c.quote?.includes("go back after the audit"))).toBe(true);
    expect((await ctx("meena")).some((c) => c.quote?.includes("go back after the audit"))).toBe(true);
    for (const v of ["kavya", "divya", "member"] as const) {
      const rows = await ctx(v);
      expect(rows.some((c) => c.quote?.includes("after the audit"))).toBe(false);
      if (v !== "divya") expect(rows.some((c) => c.access_level === "finance")).toBe(false);
    }
  });

  it("job payloads and results hold ids and counts only, never source text", async () => {
    const { data } = await as.arun.from("jobs").select("payload, result").eq("payload->>run_id", runId);
    const blob = JSON.stringify(data);
    for (const s of ["certificates", "Ganesan", "HoD", "the audit", "Brightwave"]) expect(blob).not.toContain(s);
  });

  it("audits follow-up evidence, context and status changes with the reason", async () => {
    const { data } = await as.meena.from("audit_log").select("target_type, action, reason").like("reason", "Follow-up found%");
    const kinds = new Set((data ?? []).map((r) => `${r.target_type}:${r.action}`));
    expect(kinds).toContain("evidence:insert");
    expect(kinds).toContain("context_items:insert");
    expect(kinds).toContain("obligations:update");
    const duties = await as.meena.from("audit_log").select("id").eq("target_type", "obligations").like("reason", "Recurring duty found%");
    expect((duties.data ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("a second run adds nothing, reuses saved answers and writes no new audit rows", async () => {
    const auditBefore = (await as.meena.from("audit_log").select("id", { count: "exact", head: true })).count;
    const callsBefore = provider.calls.length;
    const again = await planRun(as.arun, WS, ids.arun);
    await runAll(as.arun, again.runId, ids.arun, provider, cache);
    const p = await getRunProgress(as.arun, WS, again.runId);
    expect(p.failed).toBe(0);
    expect(p.stages.extract_commitments.created).toBe(0);
    expect(p.stages.find_duties.created).toBe(0);
    expect(p.followup.evidence + p.followup.context).toBe(0);
    expect(p.cachedSteps).toBe(p.total - 2); // every model step; the two planning steps call no model
    expect(p.matching).toEqual({ same: 0, possible: 0 });
    expect(provider.calls.length).toBe(callsBefore);
    expect((await as.meena.from("audit_log").select("id", { count: "exact", head: true })).count).toBe(auditBefore);
  });
});

describe.skipIf(!hasEnv)("record_followup, add_recurring_duty and staged claiming", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  let promiseEvent: string;
  let laterEvent: string;
  let earlierEvent: string;
  let financeEvent: string;
  let meenaDmEvent: string;
  let commitment: string;

  const eventId = async (c: Client, source: string, starts: string) =>
    (await c.from("events").select("id").eq("source_id", source).like("text", `${starts}%`).single()).data!.id;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const src = await importAs(as.arun, "c.txt", chat([
      "01/03/2026, 9:00 am - Priya: Speaker list is final, every semester we do this.",
      "02/03/2026, 7:42 pm - Arun: Sure da, we will send the participation certificates by 15 March.",
      "16/03/2026, 9:30 am - Arun: Certificates sent to all speakers.",
    ]), "committee");
    earlierEvent = await eventId(as.arun, src, "Speaker list");
    promiseEvent = await eventId(as.arun, src, "Sure da");
    laterEvent = await eventId(as.arun, src, "Certificates sent");
    const fin = await importAs(as.arun, "fin.md", new TextEncoder().encode("# Minutes\n\n## 2026-03-20: Finance\n\n- The speaker list needs Dean approval every semester."), "finance");
    financeEvent = (await as.arun.from("events").select("id").eq("source_id", fin).single()).data!.id;
    const dm = await importAs(as.meena, "dm.txt", chat([`03/03/2026, 10:00 am - Dr. Meena: ${SECRET}`]), "private");
    meenaDmEvent = (await as.meena.from("events").select("id").eq("source_id", dm).single()).data!.id;
    const add = await as.arun.rpc("add_extracted_commitment", {
      p_workspace: WS, p_event: promiseEvent, p_quote: "we will send the participation certificates", p_owed_by: "Arun",
      p_owed_to: "Workshop speakers", p_deliverable: "Send participation certificates", p_due_text: "by 15 March",
    });
    commitment = add.data![0].obligation_id;
  });
  afterAll(cleanup);

  const follow = (c: Client, evidence: Json[], context: Json[] = []) =>
    c.rpc("record_followup", { p_workspace: WS, p_obligation: commitment, p_evidence: evidence, p_context: context });

  it("a check that finds nothing verifiable records 'no evidence kept', not open", async () => {
    const r = await follow(as.arun, [
      { event_id: laterEvent, quote: "Certificates were emailed to everyone", relation: "fulfils" }, // not in the message
      { event_id: earlierEvent, quote: "Speaker list is final", relation: "fulfils" }, // before the promise
      { event_id: promiseEvent, quote: "we will send the participation certificates", relation: "fulfils" }, // the promise itself
      { event_id: meenaDmEvent, quote: SECRET, relation: "fulfils" }, // unreadable
      { event_id: "not-a-uuid", quote: "Certificates sent to all speakers", relation: "fulfils" },
      { event_id: laterEvent, quote: "Certificates sent to all speakers", relation: "supports" }, // wrong relation
    ]);
    expect(r.error).toBeNull();
    expect(r.data?.[0]).toMatchObject({ evidence_added: 0, rejected: 6, status: "no_evidence" });
    const o = await as.arun.from("obligations").select("status, fulfilment_checked_at").eq("id", commitment).single();
    expect(o.data?.status).toBe("no_evidence");
    expect(o.data?.fulfilment_checked_at).not.toBeNull();
  });

  it("a verified later report makes it fulfilled; an inferred one alone would only be likely", async () => {
    const inferred = await follow(as.arun, [{ event_id: laterEvent, quote: "sent to all speakers", relation: "fulfils", inferred: true }]);
    expect(inferred.data?.[0]).toMatchObject({ evidence_added: 1, status: "likely_fulfilled" });
    const direct = await follow(as.arun, [
      { event_id: laterEvent, quote: "Certificates sent to all speakers", relation: "fulfils" },
      { event_id: laterEvent, quote: "CERTIFICATES SENT  to all speakers", relation: "fulfils" },
    ]);
    expect(direct.data?.[0]).toMatchObject({ evidence_added: 1, duplicates: 1, status: "fulfilled" });
  });

  it("evidence from a more restricted record raises the item to that level (provenance rule)", async () => {
    const r = await follow(as.arun, [{ event_id: financeEvent, quote: "speaker list needs Dean approval", relation: "contradicts" }]);
    expect(r.data?.[0]).toMatchObject({ evidence_added: 1, status: "contradicted" });
    const kavya = await as.kavya.from("obligations").select("id").eq("id", commitment);
    expect(kavya.data).toEqual([]);
    expect((await as.divya.from("obligations").select("access_level").eq("id", commitment).single()).data?.access_level).toBe("finance");
  });

  it("checks context like evidence, and refuses non-reviewers", async () => {
    const r = await follow(as.arun, [], [
      { event_id: laterEvent, quote: "Certificates sent to all speakers", kind: "decision", note: "Sent by email." },
      { event_id: laterEvent, quote: "Certificates sent to all speakers", kind: "gossip", note: "x" },
      { event_id: laterEvent, quote: "Certificates sent to all speakers", kind: "risk", note: "" },
      { event_id: laterEvent, quote: "not in the message at all", kind: "risk", note: "x" },
    ]);
    expect(r.data?.[0]).toMatchObject({ context_added: 1, rejected: 3 });
    expect((await follow(as.kavya, [])).error?.message).toMatch(/only the outgoing lead or the advisor/);
  });

  const duty = (c: Client, over: Record<string, unknown> = {}) =>
    c.rpc("add_recurring_duty", {
      p_workspace: WS, p_description: "Finalise the speaker list", p_period: "semester", p_cadence: "every semester",
      p_approval: "", p_approver: "", p_lead_time: "", p_owed_by: "", p_next_due: null as unknown as string, p_start_by: null as unknown as string, p_next_due_basis: "",
      p_quotes: [{ event_id: earlierEvent, quote: "Speaker list is final, every semester we do this", relation: "supports" }],
      ...over,
    });

  it("stores a recurring duty only if its quotes and details are in the records", async () => {
    expect((await duty(as.arun, { p_cadence: "every year" })).error?.message).toMatch(/cadence must appear/);
    expect((await duty(as.arun, { p_approver: "Principal" })).error?.message).toMatch(/approver must appear/);
    expect((await duty(as.arun, { p_lead_time: "two weeks ahead" })).error?.message).toMatch(/lead time must appear/);
    expect((await duty(as.arun, { p_quotes: [{ event_id: earlierEvent, quote: "every semester we do this", relation: "past_instance" }] })).error?.message).toMatch(/needs a quote that states it/);
    expect((await duty(as.arun, { p_quotes: [{ event_id: earlierEvent, quote: "Speaker list must be approved", relation: "supports" }] })).error?.message).toMatch(/not a verbatim part/);
    expect((await duty(as.arun, { p_quotes: [{ event_id: meenaDmEvent, quote: SECRET, relation: "supports" }] })).error?.message).toMatch(/cited message not found/);
    expect((await duty(as.kavya)).error?.message).toMatch(/only the outgoing lead or the advisor/);
  });

  it("refuses quotes from records with different access, so no restricted text shapes an open duty", async () => {
    const r = await duty(as.arun, {
      p_quotes: [
        { event_id: earlierEvent, quote: "Speaker list is final, every semester we do this", relation: "supports" },
        { event_id: financeEvent, quote: "The speaker list needs Dean approval every semester", relation: "supports" },
      ],
    });
    expect(r.error?.message).toMatch(/same access/);
  });

  it("merges a repeat at the same level and does not restate it at a more restricted one", async () => {
    const first = await duty(as.arun);
    expect(first.data?.[0]).toMatchObject({ created: true, quotes_added: 1 });
    const again = await duty(as.arun, { p_description: "Finalise the speaker list each semester" });
    expect(again.data?.[0]).toMatchObject({ obligation_id: first.data![0].obligation_id, created: false, quotes_added: 0 });
    const restricted = await duty(as.arun, {
      p_description: "Finalise the speaker list", p_approver: "Dean",
      p_quotes: [{ event_id: financeEvent, quote: "The speaker list needs Dean approval every semester", relation: "supports" }],
    });
    expect(restricted.data?.[0]).toMatchObject({ obligation_id: first.data![0].obligation_id, created: false, quotes_added: 0 });
    const ev = await as.meena.from("evidence").select("quote").eq("obligation_id", first.data![0].obligation_id);
    expect(ev.data?.map((e) => e.quote)).toEqual(["Speaker list is final, every semester we do this"]);
  });

  it("only reviewers can plan a run", async () => {
    await expect(planRun(as.kavya, WS, ids.kavya)).rejects.toBeInstanceOf(PlanError);
  });

  it("claims jobs stage by stage, and only the requester's", async () => {
    const runId = crypto.randomUUID();
    const job = (kind: string, stage: number, chunk: number) => ({ workspace_id: WS, kind, payload: { run_id: runId, requested_by: ids.arun, stage, chunk, of: 2 } });
    const ins = await as.arun.from("jobs").insert([job("find_duties", 2, 1), job(EXTRACT_TASK, 1, 2), job(EXTRACT_TASK, 1, 1)]);
    expect(ins.error).toBeNull();
    const claim = (c: Client) => c.rpc("claim_next_run_job", { p_workspace: WS, p_run: runId });

    expect((await claim(as.meena)).data).toEqual([]);
    const a = await claim(as.arun);
    expect(a.data?.[0]).toMatchObject({ kind: EXTRACT_TASK, status: "running", attempts: 1, payload: { chunk: 1 } });
    const b = await claim(as.arun);
    expect(b.data?.[0]).toMatchObject({ kind: EXTRACT_TASK, payload: { chunk: 2 } });
    // Both stage-1 jobs are running: stage 2 must wait.
    expect((await claim(as.arun)).data).toEqual([]);
    await as.arun.from("jobs").update({ status: "done" }).in("id", [a.data![0].id, b.data![0].id]);
    expect((await claim(as.arun)).data?.[0]).toMatchObject({ kind: "find_duties" });
    expect((await claim(as.arun)).data).toEqual([]);
  });
});
