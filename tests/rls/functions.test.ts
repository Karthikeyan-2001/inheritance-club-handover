import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTEXT_ITEMS, DEMO_WORKSPACE, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import { admin, hasEnv, keys, removeMember, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const O = (k: string) => byKey(OBLIGATIONS, k).id;
const WS = DEMO_WORKSPACE.id;

describe.skipIf(!hasEnv)("approve_version and immutable versions", () => {
  let as: Record<Viewer, Client>;
  let versionId: string;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await removeMember();
  });

  it("is rejected for everyone except the advisor", async () => {
    for (const v of ["arun", "kavya", "divya", "member"] as const) {
      const { error } = await as[v].rpc("approve_version", { p_workspace: WS, p_reason: "try" });
      expect(error?.message, v).toMatch(/only the faculty advisor/);
    }
  });

  it("requires a reason", async () => {
    const { error } = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "  " });
    expect(error?.message).toMatch(/reason is required/);
  });

  it("creates a version whose items are filtered per role", async () => {
    const { data, error } = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "First handover" });
    expect(error).toBeNull();
    versionId = data as string;

    const items = async (v: Viewer) =>
      keys(((await as[v].from("version_items").select("obligation_id").eq("version_id", versionId)).data ?? [])
        .map((r) => ({ id: r.obligation_id })));
    // O5 is a draft, so it is not part of the approved version.
    expect(await items("meena")).toEqual(["O1", "O2", "O3", "O4", "O6"]);
    expect(await items("arun")).toEqual(["O1", "O2", "O3", "O4"]);
    expect(await items("divya")).toEqual(["O1", "O2", "O3"]);
    expect(await items("kavya")).toEqual(["O1", "O2", "O4"]);
    expect(await items("member")).toEqual(["O1"]);
  });

  it("stores only ids and hashes in versions, and every member can see the version row", async () => {
    const { data } = await as.kavya.from("versions").select("number, snapshot, diff").eq("id", versionId).single();
    expect(data?.number).toBeGreaterThanOrEqual(1);
    const text = JSON.stringify(data);
    expect(text).not.toContain("Robotics");
    expect(text).not.toContain("₹");
  });

  it("diffs the next version against the previous one by hash", async () => {
    const edit = await as.arun.from("obligations").update({ due_text: "by 20 March", review_state: "edited" })
      .eq("id", O("O2")).select("id");
    expect(edit.data).toHaveLength(1);
    const { data: v2 } = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "Second" });
    const { data } = await as.meena.from("versions").select("number, diff").eq("id", v2 as string).single();
    expect(data?.diff).toMatchObject({ previous_version: versionId, changed: [O("O2")], added: [], removed: [] });
  });

  it("cannot be inserted, updated or deleted directly by any user", async () => {
    const ins = await as.meena.from("versions").insert({ workspace_id: WS, number: 99, snapshot: {}, diff: {} });
    expect(ins.error?.message).toMatch(/row-level security/);
    const upd = await as.meena.from("versions").update({ number: 42 }).eq("id", versionId).select("id");
    expect(upd.data).toEqual([]);
    const del = await as.meena.from("versions").delete().eq("id", versionId).select("id");
    expect(del.data).toEqual([]);
  });

  it("cannot be changed even with the service role (trigger)", async () => {
    const a = admin();
    expect((await a.from("versions").update({ number: 42 }).eq("id", versionId)).error?.message).toMatch(/immutable/);
    expect((await a.from("versions").delete().eq("id", versionId)).error?.message).toMatch(/immutable/);
    expect((await a.from("version_items").delete().eq("version_id", versionId)).error?.message).toMatch(/immutable/);
    expect((await a.from("audit_log").update({ reason: "rewrite" }).eq("workspace_id", WS)).error?.message).toMatch(/immutable/);
    expect((await a.from("audit_log").delete().eq("workspace_id", WS)).error?.message).toMatch(/immutable/);
  });

  describe("acknowledgements", () => {
    it("the incoming lead can respond; a change is a new row and the latest wins", async () => {
      const first = await as.kavya.auth.getUser();
      const uid = first.data.user!.id;
      expect((await as.kavya.from("acks").insert({ version_id: versionId, obligation_id: O("O1"), user_id: uid, action: "accept" })).error).toBeNull();
      expect((await as.kavya.from("acks").insert({ version_id: versionId, obligation_id: O("O1"), user_id: uid, action: "question", note: "Who signs it?" })).error).toBeNull();

      const latest = await as.kavya.from("latest_acks").select("action, note").eq("version_id", versionId).eq("obligation_id", O("O1"));
      expect(latest.data).toEqual([{ action: "question", note: "Who signs it?" }]);
      const all = await as.kavya.from("acks").select("id").eq("version_id", versionId);
      expect(all.data).toHaveLength(2);
    });

    it("acks cannot be edited, even by the service role", async () => {
      const upd = await as.kavya.from("acks").update({ action: "decline" }).eq("version_id", versionId).select("id");
      expect(upd.data).toEqual([]);
      const a = admin();
      expect((await a.from("acks").update({ action: "decline" }).eq("version_id", versionId)).error?.message).toMatch(/immutable/);
    });

    it("cannot be made on items the incoming lead cannot see, or by other roles", async () => {
      const kUid = (await as.kavya.auth.getUser()).data.user!.id;
      const hidden = await as.kavya.from("acks").insert({ version_id: versionId, obligation_id: O("O3"), user_id: kUid, action: "accept" });
      expect(hidden.error?.message).toMatch(/row-level security/);
      const dUid = (await as.divya.auth.getUser()).data.user!.id;
      const wrongRole = await as.divya.from("acks").insert({ version_id: versionId, obligation_id: O("O1"), user_id: dUid, action: "accept" });
      expect(wrongRole.error?.message).toMatch(/row-level security/);
    });

    it("reviewers see the incoming lead's responses; others do not", async () => {
      expect(((await as.arun.from("acks").select("id").eq("version_id", versionId)).data ?? []).length).toBe(2);
      expect((await as.divya.from("acks").select("id").eq("version_id", versionId)).data).toEqual([]);
    });
  });
});

describe.skipIf(!hasEnv)("release_item", () => {
  let as: Record<Viewer, Client>;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await removeMember();
  });

  const release = (c: Client, target: string, type: "obligation" | "context_item" = "obligation", reason = "test") =>
    c.rpc("release_item", { p_target_type: type, p_target_id: target, p_to_role: "incoming_lead", p_reason: reason });

  it("the outgoing lead cannot release someone else's private item or a non-private item", async () => {
    expect((await release(as.arun, O("O6"))).error?.message).toMatch(/not allowed/);
    expect((await release(as.arun, O("O3"))).error?.message).toMatch(/not allowed/);
  });

  it("other roles cannot release anything", async () => {
    expect((await release(as.kavya, O("O5"))).error?.message).toMatch(/not allowed/);
    expect((await release(as.divya, O("O5"))).error?.message).toMatch(/not allowed/);
  });

  it("a reason is required", async () => {
    expect((await release(as.arun, O("O5"), "obligation", "")).error?.message).toMatch(/reason is required/);
  });

  it("the outgoing lead releases their own private item; it becomes visible and is audited", async () => {
    expect((await as.kavya.from("obligations").select("id").eq("id", O("O5"))).data).toEqual([]);
    expect((await release(as.arun, O("O5"), "obligation", "Kavya should know about this")).error).toBeNull();
    expect((await as.kavya.from("obligations").select("id").eq("id", O("O5"))).data).toHaveLength(1);
    const audit = await as.meena.from("audit_log").select("action, reason, actor").eq("obligation_id", O("O5")).eq("action", "release");
    const arunId = (await as.arun.auth.getUser()).data.user!.id;
    expect(audit.data).toEqual([{ action: "release", reason: "Kavya should know about this", actor: arunId }]);
  });

  it("the advisor can release a finance item to the incoming lead", async () => {
    expect((await as.kavya.from("obligations").select("id").eq("id", O("O3"))).data).toEqual([]);
    expect((await release(as.meena, O("O3"))).error).toBeNull();
    expect((await as.kavya.from("obligations").select("id").eq("id", O("O3"))).data).toHaveLength(1);
    // Context attached to it stays hidden unless released separately.
    const c2 = byKey(CONTEXT_ITEMS, "C2").id;
    expect((await as.kavya.from("context_items").select("id").eq("id", c2)).data).toEqual([]);
    expect((await release(as.meena, c2, "context_item")).error).toBeNull();
    expect((await as.kavya.from("context_items").select("id").eq("id", c2)).data).toHaveLength(1);
  });

  it("releases cannot be written directly", async () => {
    const ins = await as.meena.from("releases").insert({
      workspace_id: WS, target_type: "obligation", target_id: O("O6"), to_role: "incoming_lead", reason: "x",
    });
    expect(ins.error?.message).toMatch(/row-level security/);
  });
});

describe.skipIf(!hasEnv)("audit log", () => {
  let as: Record<Viewer, Client>;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await removeMember();
  });

  it("every change to an obligation writes actor, action, before and after", async () => {
    const arunId = (await as.arun.auth.getUser()).data.user!.id;
    const upd = await as.arun.from("obligations").update({ review_state: "rejected" }).eq("id", O("O1")).select("id");
    expect(upd.data).toHaveLength(1);
    const { data } = await as.meena.from("audit_log")
      .select("actor, action, target_type, before, after")
      .eq("obligation_id", O("O1")).eq("action", "update");
    expect(data).toHaveLength(1);
    const row = data![0];
    expect(row).toMatchObject({ actor: arunId, action: "update", target_type: "obligations" });
    expect((row.before as { review_state: string }).review_state).toBe("accepted");
    expect((row.after as { review_state: string }).review_state).toBe("rejected");
  });
});
