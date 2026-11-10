import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, hasEnv, cleanup, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

// Builds a throwaway workspace with a row in every table (including immutable ones), then
// proves delete_workspace() removes all of it and that only reviewers may call it.
describe.skipIf(!hasEnv)("delete_workspace", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  const ws = crypto.randomUUID();
  const ref: Record<string, string> = {};

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const a = admin();
    const must = <T,>(label: string, r: { error: { message: string } | null; data: T }): NonNullable<T> => {
      if (r.error) throw new Error(`${label}: ${r.error.message}`);
      if (r.data === null || r.data === undefined) throw new Error(`${label}: no data`);
      return r.data;
    };
    const ok = (label: string, r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(`${label}: ${r.error.message}`);
    };

    must("ws", await a.from("workspaces").insert({ id: ws, name: "Throwaway (SYNTHETIC)" }).select("id"));
    ok("members", await a.from("memberships").insert([
      { workspace_id: ws, user_id: ids.arun, role: "outgoing_lead" },
      { workspace_id: ws, user_id: ids.meena, role: "advisor" },
      { workspace_id: ws, user_id: ids.kavya, role: "incoming_lead" },
    ]));
    ref.source = must("source", await a.from("sources").insert({
      workspace_id: ws, type: "whatsapp", filename: "dm.txt", access_level: "private", uploaded_by: ids.arun, sha256: "t1",
    }).select("id").single()).id;
    ref.event = must("event", await a.from("events").insert({
      workspace_id: ws, source_id: ref.source, text: "I will bring the projector on Friday.", access_level: "private",
    }).select("id").single()).id;
    ref.obligation = must("obligation", await a.from("obligations").insert({
      workspace_id: ws, kind: "commitment", description: "Bring the projector", review_state: "accepted",
    }).select("id").single()).id;
    ref.evidence = must("evidence", await a.from("evidence").insert({
      obligation_id: ref.obligation, event_id: ref.event, quote: "bring the projector", relation: "supports", verified: true,
    }).select("id").single()).id;
    ref.context = must("context", await a.from("context_items").insert({
      obligation_id: ref.obligation, kind: "contact", text: "AV room", access_level: "committee",
    }).select("id").single()).id;
    const second = must("obligation 2", await a.from("obligations").insert({
      workspace_id: ws, kind: "commitment", description: "Bring the projector to the lab", review_state: "draft",
    }).select("id").single()).id;
    const [x, y] = [ref.obligation, second].sort();
    ok("link", await a.from("obligation_links").insert({ workspace_id: ws, a: x, b: y, verdict: "possible", method: "rule" }));
    ok("docket", await a.from("docket_entries").insert({ workspace_id: ws, claim_a_event: ref.event, claim_b_event: ref.event, summary: "t" }));
    ok("sealed", await a.from("sealed_items").insert({ workspace_id: ws, holder_role: "advisor", topic_label: "t" }));
    ok("alias", await a.from("aliases").insert({ workspace_id: ws, canonical: "t", kind: "person" }));
    ok("job", await a.from("jobs").insert({ workspace_id: ws, kind: "noop" }));

    must("release", await as.arun.rpc("release_item", {
      p_target_type: "obligation", p_target_id: ref.obligation, p_to_role: "incoming_lead", p_reason: "t",
    }));
    const cur = must("current", await a.from("obligations").select("status, trust_state").eq("id", ref.obligation).single());
    ok("baseline", await a.from("obligations").update({ reviewed_status: cur.status, reviewed_trust: cur.trust_state }).eq("id", ref.obligation));
    ref.signoff = must("ready", await as.arun.rpc("mark_ready", { p_workspace: ws, p_reason: "t" })) as string;
    ref.version = must("approve", await as.meena.rpc("approve_version", { p_workspace: ws, p_reason: "t" })) as string;
    ok("ack", await as.kavya.from("acks").insert({
      version_id: ref.version, obligation_id: ref.obligation, user_id: ids.kavya, action: "accept",
    }));
  });

  afterAll(async () => {
    await cleanup();
  });

  async function counts() {
    const a = admin();
    const byWs = ["memberships", "sources", "events", "obligations", "docket_entries", "sealed_items",
      "aliases", "jobs", "obligation_links", "versions", "version_items", "version_context_items", "review_signoffs", "releases", "audit_log"] as const;
    const out: Record<string, number> = {};
    out.workspaces = (await a.from("workspaces").select("*", { count: "exact", head: true }).eq("id", ws)).count ?? 0;
    for (const t of byWs) {
      const { count, error } = await a.from(t).select("*", { count: "exact", head: true }).eq("workspace_id", ws);
      if (error) throw new Error(`${t}: ${error.message}`);
      out[t] = count ?? 0;
    }
    out.evidence = (await a.from("evidence").select("*", { count: "exact", head: true }).eq("id", ref.evidence)).count ?? 0;
    out.context_items = (await a.from("context_items").select("*", { count: "exact", head: true }).eq("id", ref.context)).count ?? 0;
    out.acks = (await a.from("acks").select("*", { count: "exact", head: true }).eq("version_id", ref.version)).count ?? 0;
    return out;
  }

  it("starts with a row in every table", async () => {
    const c = await counts();
    for (const [t, n] of Object.entries(c)) expect(n, t).toBeGreaterThan(0);
  });

  it("is refused for the incoming lead and requires a reason", async () => {
    expect((await as.kavya.rpc("delete_workspace", { p_workspace: ws, p_reason: "nope" })).error?.message)
      .toMatch(/only the outgoing lead or advisor/);
    expect((await as.arun.rpc("delete_workspace", { p_workspace: ws, p_reason: "" })).error?.message)
      .toMatch(/reason is required/);
  });

  it("removes every row, including immutable versions, acks and audit entries", async () => {
    const { error } = await as.arun.rpc("delete_workspace", { p_workspace: ws, p_reason: "end of demo" });
    expect(error).toBeNull();
    const c = await counts();
    for (const [t, n] of Object.entries(c)) expect(n, t).toBe(0);
  });

  it("leaves the demo workspace untouched", async () => {
    const { count } = await admin().from("obligations").select("*", { count: "exact", head: true })
      .eq("workspace_id", "d0000001-0000-4000-8000-000000000001");
    expect(count).toBe(6);
  });
});
