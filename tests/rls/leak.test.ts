// The leak test (Phase 12). Both generated scenarios (SYNTHETIC) go through the whole flow in
// the demo workspace: each file imported by its own uploader at its own level, the ledger built
// by the advisor (who reads everything, the worst case) with the offline fake, every item
// accepted, a version signed off, an answer from the incoming lead. Then every row each role can
// read, from every table, view and read function, is searched for restricted text: finance
// amounts and the subjects of private chats. A role may see a restricted text only if it may
// read at least one file that contains it. Each text must also be visible to someone, so the
// test cannot pass by reading nothing.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canRead, type AppRole } from "../../src/lib/access.ts";
import { DEMO_WORKSPACE } from "../../src/lib/demo/fixture.ts";
import { loadScenario, type Scenario } from "../../src/lib/eval/scenario.ts";
import { sha256Hex } from "../../src/lib/hash.ts";
import { MemoryLlmCache } from "../../src/lib/llm/cache-memory.ts";
import { FakeProvider } from "../../src/lib/llm/provider-fake.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { fakeHandlers } from "../../src/lib/pipeline/provider.ts";
import { getRunProgress, planRun, runNextStep } from "../../src/lib/pipeline/run-pipeline.ts";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const ENV = { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" };
const VIEWERS = ["arun", "meena", "kavya", "divya", "member"] as const;
const ROLE: Record<Viewer, AppRole> = { arun: "outgoing_lead", meena: "advisor", kavya: "incoming_lead", divya: "treasurer", member: "member" };
const SCENARIOS = ["year", "photo"] as const;

type Table = keyof Database["public"]["Tables"];
const TABLES: Table[] = [
  "workspaces", "memberships", "sources", "events", "obligations", "evidence", "context_items", "obligation_links", "docket_entries",
  "versions", "version_items", "version_context_items", "review_signoffs", "releases", "sealed_items", "acks", "aliases", "audit_log",
  "jobs", "llm_cache", "demo_sandboxes",
];

/** Everything a viewer can read, as one JSON text per source (table, view or function). */
async function everythingReadable(c: Client): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await c.from(t).select("*").range(from, from + 999);
      if (error) {
        // A table the role may not read at all is fine; record it so the test can see it was tried.
        out[t] = `error: ${error.message}`;
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (!out[t]) out[t] = JSON.stringify(rows);
  }
  out.latest_acks = JSON.stringify((await c.from("latest_acks").select("*")).data ?? []);
  for (const fn of ["pending_review", "signoff_status", "event_authors"] as const) out[fn] = JSON.stringify((await c.rpc(fn, { p_workspace: WS })).data ?? []);
  return out;
}

async function importScenario(as: Record<Viewer, Client>, s: Scenario) {
  for (const f of s.files) {
    const parsed = await parseUpload(f.name, f.bytes);
    const filename = `${s.name}-${f.name}`; // both scenarios have a whatsapp-committee.txt
    const { error } = await as[f.uploader].rpc("import_source", {
      p_workspace: WS, p_type: parsed.summary.sourceType, p_filename: filename, p_access: f.accessLevel, p_sha256: sha256Hex(f.bytes),
      p_summary: parsed.summary,
      p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
      p_reason: "leak test import (synthetic scenario)",
    });
    if (error) throw new Error(`${filename}: ${error.message}`);
  }
}

describe.skipIf(!hasEnv)("leak test: two synthetic scenarios through the whole flow", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  let scenarios: Scenario[];
  let readable: Record<Viewer, Record<string, string>>;
  let accepted = 0;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    scenarios = await Promise.all(SCENARIOS.map((n) => loadScenario(n)));
    for (const s of scenarios) await importScenario(as, s);

    const { runId } = await planRun(as.meena, WS, ids.meena);
    const deps = { provider: new FakeProvider(fakeHandlers()), cache: new MemoryLlmCache(), env: ENV, today: "2026-11-10" };
    for (let i = 0; i < 1000 && (await runNextStep(as.meena, WS, runId, ids.meena, deps)); i++);
    const p = await getRunProgress(as.meena, WS, runId);
    if (p.pending || p.failed) throw new Error(`run did not finish cleanly: ${JSON.stringify({ pending: p.pending, failed: p.failed })}`);

    // Accept every draft, and again every accepted fixture item the run changed (the advisor
    // reads them all), then mark ready and approve.
    const { data: drafts } = await as.meena.from("obligations").select("id").eq("workspace_id", WS).eq("review_state", "draft");
    const { data: pending, error: pErr } = await as.meena.rpc("pending_review", { p_workspace: WS });
    if (pErr) throw new Error(`pending_review: ${pErr.message}`);
    const toAccept = [...(drafts ?? []).map((d) => d.id), ...(pending ?? []).filter((p) => p.needs_rereview).map((p) => p.obligation_id)];
    for (const id of toAccept) {
      const { error } = await as.meena.rpc("review_obligation", { p_id: id, p_action: "accept", p_reason: "Checked against the quotes (leak test)" });
      if (error) throw new Error(`accept ${id}: ${error.message}`);
      accepted++;
    }
    const ready = await as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: "Ready (leak test)" });
    if (ready.error) throw new Error(`mark_ready: ${ready.error.message}`);
    const approved = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "Approved (leak test)" });
    if (approved.error) throw new Error(`approve_version: ${approved.error.message}`);

    // The incoming lead answers one item of the new version, so acks and their audit rows exist.
    const { data: item } = await as.kavya.from("version_items").select("obligation_id").eq("version_id", approved.data as string).limit(1).single();
    if (item) await as.kavya.from("acks").insert({ version_id: approved.data as string, obligation_id: item.obligation_id, user_id: ids.kavya, action: "question", note: "Who holds this now?" });

    readable = Object.fromEntries(await Promise.all(VIEWERS.map(async (v) => [v, await everythingReadable(as[v])] as const))) as typeof readable;
  }, 300_000);
  afterAll(cleanup, 120_000);

  /** Who may read a restricted text: anyone who may read a file that contains it. */
  const allowed = (s: Scenario, text: string): Set<Viewer> => {
    const out = new Set<Viewer>();
    for (const f of s.files) {
      if (!s.events.some((e) => e.file === f.name && e.text.includes(text))) continue;
      for (const v of VIEWERS) {
        if (canRead({ role: ROLE[v], userId: v, level: f.accessLevel, privateUploaders: f.accessLevel === "private" ? [f.uploader] : [], releasedToRole: false })) out.add(v);
      }
    }
    return out;
  };

  it("built and approved a ledger from both scenarios", () => {
    expect(accepted).toBeGreaterThan(20);
    expect(JSON.parse(readable.kavya.version_items).length).toBeGreaterThan(0);
  });

  for (const name of SCENARIOS) {
    it(`no role reads restricted text from the ${name} scenario that it may not`, () => {
      const s = scenarios.find((x) => x.name === name)!;
      const leaks: string[] = [];
      for (const r of s.truth.restricted) {
        const ok = allowed(s, r.text);
        for (const v of VIEWERS) {
          if (ok.has(v)) continue;
          for (const [where, json] of Object.entries(readable[v])) if (json.includes(r.text)) leaks.push(`${v} reads "${r.text}" (${r.level}) in ${where}`);
        }
      }
      expect(leaks).toEqual([]);
    });

    it(`every restricted text of the ${name} scenario is readable by someone allowed (the test is not vacuous)`, () => {
      const s = scenarios.find((x) => x.name === name)!;
      for (const r of s.truth.restricted) {
        const seenBy = VIEWERS.filter((v) => Object.values(readable[v]).some((json) => json.includes(r.text)));
        expect([r.text, seenBy.length > 0]).toEqual([r.text, true]);
        for (const v of seenBy) expect(allowed(s, r.text).has(v), `${v} / ${r.text}`).toBe(true);
      }
    });
  }

  it("the advisor's private chat reaches no one else; the outgoing lead's reaches only the advisor", () => {
    const year = scenarios.find((s) => s.name === "year")!;
    const photo = scenarios.find((s) => s.name === "photo")!;
    expect([...allowed(year, "condonation")]).toEqual(["meena"]);
    expect([...allowed(photo, "scholarship")].sort()).toEqual(["arun", "meena"]);
    // And the private item built from each exists, for those who may read it.
    expect(readable.meena.obligations).toContain("condonation");
    expect(readable.arun.obligations).toContain("scholarship");
    expect(readable.arun.obligations).not.toContain("condonation");
  });

  it("the incoming lead and members read no working ledger rows, only the approved version", () => {
    for (const v of ["kavya", "member"] as const) {
      for (const t of ["obligations", "evidence", "context_items", "obligation_links", "docket_entries"]) expect([v, t, readable[v][t]]).toEqual([v, t, "[]"]);
    }
  });

  it("nobody but the service role reads the model cache, jobs of others or demo bookkeeping", () => {
    for (const v of VIEWERS) {
      expect([v, readable[v].llm_cache]).toEqual([v, readable[v].llm_cache.startsWith("error") ? readable[v].llm_cache : "[]"]);
      expect([v, readable[v].demo_sandboxes]).toEqual([v, readable[v].demo_sandboxes.startsWith("error") ? readable[v].demo_sandboxes : "[]"]);
    }
    // Job rows hold ids and counts only, never text (the advisor ran the pipeline and reads its jobs).
    for (const s of scenarios) for (const r of s.truth.restricted) expect(readable.meena.jobs).not.toContain(r.text);
  });
});
