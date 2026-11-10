import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_ITEMS, DEMO_WORKSPACE, DOCKET_ENTRIES, EVENTS, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import { admin, cleanup, hasEnv, keys, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const O = (k: string) => byKey(OBLIGATIONS, k).id;
const WS = DEMO_WORKSPACE.id;
const D1 = byKey(DOCKET_ENTRIES, "D1").id;

describe.skipIf(!hasEnv)("review actions, sign-off, rulings and versions", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;

  beforeAll(async () => {
    // keep a clean state per test: each one changes review data
  });
  beforeEach(async () => {
    ids = await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await cleanup();
  });

  const review = (c: Client, id: string, action: string, reason = "checked", changes?: Record<string, unknown>) =>
    c.rpc("review_obligation", { p_id: id, p_action: action, p_reason: reason, ...(changes ? { p_changes: changes as never } : {}) });
  const ready = (reason = "Ready for the advisor") => as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: reason });
  const approve = (reason = "Approved") => as.meena.rpc("approve_version", { p_workspace: WS, p_reason: reason });
  const row = async (id: string) =>
    (await admin().from("obligations").select("review_state, status, trust_state, reviewed_status, reviewed_trust, due_text").eq("id", id).single()).data!;

  describe("review actions", () => {
    it("a direct update by a signed-in user is refused, so no change skips a reason and the audit", async () => {
      const upd = await as.arun.from("obligations").update({ due_text: "tomorrow" }).eq("id", O("O2"));
      expect(upd.error?.message).toMatch(/reason is required/);
      const state = await as.arun.from("obligations").update({ review_state: "accepted" }).eq("id", O("O5"));
      expect(state.error?.message).toMatch(/reason is required/);
      expect((await row(O("O5"))).review_state).toBe("draft");
    });

    it("a new item inserted by a user is always a draft", async () => {
      const ins = await as.arun.from("obligations").insert({ workspace_id: WS, kind: "commitment", description: "Test item", review_state: "accepted" }).select("review_state").single();
      expect(ins.data?.review_state).toBe("draft");
    });

    it("only the outgoing lead or the advisor can review; a reason and a known action are required", async () => {
      expect((await review(as.divya, O("O1"), "reject")).error?.message).toMatch(/only the outgoing lead or the advisor/);
      // The incoming lead and members cannot even see the working ledger.
      for (const v of ["kavya", "member"] as const) expect((await review(as[v], O("O1"), "reject")).error?.message, v).toMatch(/not found/);
      expect((await review(as.arun, O("O1"), "reject", "  ")).error?.message).toMatch(/reason is required/);
      expect((await review(as.arun, O("O1"), "delete")).error?.message).toMatch(/unknown review action/);
      expect((await review(as.arun, O("O6"), "accept")).error?.message).toMatch(/not found/); // the advisor's private item
    });

    it("accept, edit, reject and reopen each write an audit row with actor, reason, before and after", async () => {
      expect((await review(as.arun, O("O5"), "accept", "Quote checked")).data).toBe("accepted");
      expect((await review(as.arun, O("O5"), "edit", "Added the due date", { due_text: "by 31 March" })).data).toBe("edited");
      expect((await review(as.arun, O("O5"), "reject", "Settled outside the club")).data).toBe("rejected");
      expect((await review(as.arun, O("O5"), "reopen", "It came up again")).data).toBe("draft");
      const { data } = await as.meena.from("audit_log").select("actor, action, reason, before, after").eq("obligation_id", O("O5")).eq("target_type", "obligations").neq("action", "insert").order("id");
      const actions = (data ?? []).map((r) => [r.action, r.reason]);
      expect(actions).toEqual([
        ["accept", "Quote checked"], ["edit", "Added the due date"], ["reject", "Settled outside the club"], ["reopen", "It came up again"],
      ]);
      expect(data!.every((r) => r.actor === ids.arun)).toBe(true);
      const edit = data![1];
      expect((edit.before as { due_text: string | null }).due_text).toBeNull();
      expect((edit.after as { due_text: string }).due_text).toBe("by 31 March");
    });

    it("edits are limited to the fields a reviewer may change; status and trust come from evidence", async () => {
      for (const field of ["status", "trust_state", "access_level", "review_state", "reviewed_status"]) {
        expect((await review(as.arun, O("O2"), "edit", "x", { [field]: "fulfilled" })).error?.message, field).toMatch(/cannot be edited/);
      }
      expect((await review(as.arun, O("O2"), "edit", "x", { cadence: "yearly" })).error?.message).toMatch(/cannot be edited/); // a duty's field
      expect((await review(as.arun, O("O2"), "edit", "x", {})).error?.message).toMatch(/nothing to change/);
      expect((await review(as.arun, O("O2"), "edit", "x", { description: " " })).error?.message).toMatch(/cannot be empty/);
      expect((await review(as.arun, O("O2"), "edit", "x", { owed_to: "Speakers and guests", due_date: "2026-03-20", due_text: "" })).error).toBeNull();
      expect(await row(O("O2"))).toMatchObject({ review_state: "edited", due_text: null });
    });

    it("a rejected item must be reopened before it can be edited", async () => {
      await review(as.arun, O("O5"), "reject", "x");
      expect((await review(as.arun, O("O5"), "edit", "x", { owed_to: "Someone" })).error?.message).toMatch(/reopen/);
    });
  });

  describe("re-review after the evidence moves", () => {
    // A later run adds a Trello "done" record to O3, whose only record so far is the finance minutes.
    const evidenceMoves = () =>
      admin().from("evidence").insert({
        obligation_id: O("O3"), event_id: byKey(EVENTS, "E9").id, relation: "fulfils", verified: true,
        quote: "Card moved to Done: Send certificates to workshop speakers",
      });

    it("an item whose trust or status changed since it was accepted is flagged, and blocks mark-ready and approval", async () => {
      expect((await ready("First mark")).error).toBeNull();
      expect((await evidenceMoves()).error).toBeNull();
      const now = await row(O("O3"));
      expect(now.trust_state).not.toBe(now.reviewed_trust);

      const pending = await as.arun.rpc("pending_review", { p_workspace: WS });
      expect(pending.data?.filter((p) => p.needs_rereview).map((p) => p.obligation_id)).toEqual([O("O3")]);

      expect((await ready("Second mark")).error?.message).toMatch(/changed since they were accepted/);
      expect((await approve()).error?.message).toMatch(/changed since they were accepted/);

      expect((await review(as.arun, O("O3"), "accept", "Seen the new record")).error).toBeNull();
      const settled = await row(O("O3"));
      expect([settled.reviewed_status, settled.reviewed_trust]).toEqual([settled.status, settled.trust_state]);
      expect((await ready("Third mark")).error).toBeNull();
      expect((await approve()).error).toBeNull();
    });

    it("rejecting an item takes away the evidence it lent to its twin, and flags the twin", async () => {
      // O3 borrows O2's records once they are linked as the same item.
      expect((await as.arun.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O2"), p_b: O("O3"), p_verdict: "same", p_reason: "Same promise" })).error).toBeNull();
      expect((await row(O("O3"))).trust_state).toBe("contradicted");
      expect((await review(as.arun, O("O3"), "accept", "Looks right")).error).toBeNull();
      expect((await review(as.arun, O("O2"), "reject", "Not a promise")).error).toBeNull();
      const o3 = await row(O("O3"));
      expect(o3.trust_state).toBe("sourced");
      expect(o3.trust_state).not.toBe(o3.reviewed_trust);
    });
  });

  describe("two-step sign-off", () => {
    it("only the outgoing lead marks ready; the advisor cannot approve before that", async () => {
      expect((await as.meena.rpc("mark_ready", { p_workspace: WS, p_reason: "x" })).error?.message).toMatch(/only the outgoing lead/);
      expect((await as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: " " })).error?.message).toMatch(/reason is required/);
      expect((await approve()).error?.message).toMatch(/not marked the draft ready/);
    });

    it("an approval is refused when nothing is accepted", async () => {
      const a = admin();
      await a.from("obligations").update({ review_state: "draft" }).eq("workspace_id", WS);
      expect((await ready()).error?.message).toMatch(/accept at least one/);
      expect((await approve()).error?.message).toMatch(/nothing to approve/);
    });

    it("any change to the accepted draft after the mark means it must be marked ready again", async () => {
      expect((await ready()).error).toBeNull();
      expect((await review(as.arun, O("O4"), "edit", "Corrected", { due_text: "by 20 April" })).error).toBeNull();
      expect((await approve()).error?.message).toMatch(/marked ready again/);
      expect((await ready("Marked again")).error).toBeNull();
      expect((await approve()).error).toBeNull();
    });

    it("a context note added after the mark also needs a new mark", async () => {
      expect((await ready()).error).toBeNull();
      await admin().from("context_items").insert({ obligation_id: O("O1"), kind: "risk", text: "Letters take a week.", access_level: "everyone" });
      expect((await approve()).error?.message).toMatch(/marked ready again/);
    });

    it("an advisor's ruling does not invalidate the mark", async () => {
      expect((await ready()).error).toBeNull();
      expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "not_done", p_reason: "The chat is later" })).error).toBeNull();
      expect((await approve()).error).toBeNull();
    });

    it("mark-ready is audited and the sign-offs are append-only, even for the service role", async () => {
      expect((await ready("Checked every quote")).error).toBeNull();
      const audit = await as.meena.from("audit_log").select("actor, reason").eq("action", "mark_ready");
      expect(audit.data).toEqual([{ actor: ids.arun, reason: "Checked every quote" }]);
      expect((await as.arun.from("review_signoffs").select("id")).data).toHaveLength(1);
      expect((await as.kavya.from("review_signoffs").select("id")).data).toEqual([]);
      const a = admin();
      expect((await a.from("review_signoffs").update({ reason: "x" }).eq("workspace_id", WS)).error?.message).toMatch(/immutable/);
      expect((await a.from("review_signoffs").delete().eq("workspace_id", WS)).error?.message).toMatch(/immutable/);
    });
  });

  describe("rulings on conflicts", () => {
    it("only the advisor rules, with a valid ruling and a reason", async () => {
      expect((await as.arun.rpc("rule_conflict", { p_entry: D1, p_ruling: "done", p_reason: "x" })).error?.message).toMatch(/only the faculty advisor/);
      expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "maybe", p_reason: "x" })).error?.message).toMatch(/must be done/);
      expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "done", p_reason: " " })).error?.message).toMatch(/reason is required/);
    });

    it("is recorded and audited, may be changed, and does not change the item's trust or status", async () => {
      expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "not_done", p_reason: "Priya's message is later" })).error).toBeNull();
      expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "cannot_tell", p_reason: "Asked the speakers" })).error).toBeNull();
      const entry = await as.arun.from("docket_entries").select("ruling, reason, ruled_by").eq("id", D1).single();
      expect(entry.data).toEqual({ ruling: "cannot_tell", reason: "Asked the speakers", ruled_by: ids.meena });
      expect(await row(O("O2"))).toMatchObject({ trust_state: "contradicted", status: "contradicted" });
      const audit = await as.meena.from("audit_log").select("action, reason, before, after").eq("target_type", "docket_entries").eq("action", "rule").order("id");
      expect(audit.data).toHaveLength(2);
      expect((audit.data![1].before as { ruling: string }).ruling).toBe("not_done");
      expect((audit.data![1].after as { ruling: string }).ruling).toBe("cannot_tell");
    });

    it("cannot be written by a plain update, even by the advisor", async () => {
      const upd = await as.meena.from("docket_entries").update({ ruling: "done", reason: "x" }).eq("id", D1);
      expect(upd.error?.message).toMatch(/ruling action/);
    });
  });

  describe("reviewer verdicts on links", () => {
    it("'not the same' is remembered: a later run cannot link the pair or lend evidence", async () => {
      expect((await as.arun.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O3"), p_b: O("O2"), p_verdict: "distinct", p_reason: "Different promises" })).error).toBeNull();
      const again = await as.arun.rpc("link_obligations", { p_workspace: WS, p_a: O("O2"), p_b: O("O3"), p_verdict: "same", p_method: "rule", p_score: 0.9 });
      expect(again.data?.[0]).toMatchObject({ created: false, verdict: "distinct" });
      expect((await row(O("O3"))).trust_state).toBe("sourced");
      const link = await as.arun.from("obligation_links").select("verdict, method").eq("workspace_id", WS);
      expect(link.data).toEqual([{ verdict: "distinct", method: "reviewer" }]);
    });

    it("a reviewer can change a verdict; each change is audited by name", async () => {
      await as.arun.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O2"), p_b: O("O3"), p_verdict: "distinct", p_reason: "First thought" });
      await as.arun.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O2"), p_b: O("O3"), p_verdict: "same", p_reason: "On second thought" });
      expect((await row(O("O3"))).trust_state).toBe("contradicted");
      const audit = await as.meena.from("audit_log").select("action, reason").eq("target_type", "obligation_links").order("id");
      expect(audit.data).toEqual([
        { action: "link_distinct", reason: "First thought" }, { action: "link_same", reason: "On second thought" },
      ]);
    });

    it("needs the reviewer role, a reason, a valid verdict and items of the same kind", async () => {
      const call = (c: Client, b: string, verdict = "same", reason = "x") =>
        c.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O2"), p_b: b, p_verdict: verdict, p_reason: reason });
      expect((await call(as.divya, O("O3"))).error?.message).toMatch(/only the outgoing lead or the advisor/);
      expect((await call(as.arun, O("O3"), "same", " ")).error?.message).toMatch(/reason is required/);
      expect((await call(as.arun, O("O3"), "possible")).error?.message).toMatch(/same or distinct/);
      expect((await call(as.arun, O("O1"))).error?.message).toMatch(/same kind/); // O1 is a duty
    });
  });

  describe("versions", () => {
    it("hold evidence flags, same-item links and rulings, and notes keep their own level", async () => {
      await as.arun.rpc("set_link_verdict", { p_workspace: WS, p_a: O("O2"), p_b: O("O3"), p_verdict: "same", p_reason: "Same promise" });
      expect((await as.meena.rpc("release_item", { p_target_type: "obligation", p_target_id: O("O3"), p_to_role: "incoming_lead", p_reason: "For Kavya" })).error).toBeNull();
      await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "not_done", p_reason: "Later message wins" });
      await review(as.arun, O("O3"), "accept", "Re-checked with the link");
      expect((await ready()).error).toBeNull();
      const v = (await approve()).data as string;

      const items = await as.meena.from("version_items").select("obligation_id, item_format, item").eq("version_id", v);
      const o2 = items.data!.find((i) => i.obligation_id === O("O2"))!;
      const item = o2.item as { format: number; evidence: { inferred: boolean }[]; linked_same: string[]; conflicts: { ruling: string; reason: string }[] };
      expect(o2.item_format).toBe(2);
      expect(item.format).toBe(2);
      expect(item.evidence.every((e) => typeof e.inferred === "boolean")).toBe(true);
      expect(item.linked_same).toEqual([]); // O3 is more restricted than O2, so nothing is lent downwards
      expect(item.conflicts).toMatchObject([{ ruling: "not_done", reason: "Later message wins" }]);
      const o3 = items.data!.find((i) => i.obligation_id === O("O3"))!.item as { linked_same: string[] };
      expect(o3.linked_same).toEqual([O("O2")]);

      // Kavya can read O3 in the version (released) but not its finance note until that is released too.
      const notes = async (c: Client) => keys((await c.from("version_context_items").select("context_item_id").eq("version_id", v)).data?.map((r) => ({ id: r.context_item_id })) ?? []);
      expect(await notes(as.meena)).toEqual(["C1", "C2"]);
      expect(await notes(as.arun)).toEqual(["C1", "C2"]);
      expect(await notes(as.kavya)).toEqual(["C1"]);
      expect((await as.meena.rpc("release_item", { p_target_type: "context_item", p_target_id: byKey(CONTEXT_ITEMS, "C2").id, p_to_role: "incoming_lead", p_reason: "Needed" })).error).toBeNull();
      expect(await notes(as.kavya)).toEqual(["C1", "C2"]);
      expect(await notes(as.member)).toEqual([]);
    });

    it("version context notes are append-only, even for the service role", async () => {
      expect((await ready()).error).toBeNull();
      const v = (await approve()).data as string;
      const a = admin();
      expect((await a.from("version_context_items").update({ text: "x" }).eq("version_id", v)).error?.message).toMatch(/immutable/);
      expect((await a.from("version_context_items").delete().eq("version_id", v)).error?.message).toMatch(/immutable/);
    });

    it("an older (format 1) version is compared on the fields it has, not reported as all changed", async () => {
      const a = admin();
      const v1 = (await a.from("versions").insert({ workspace_id: WS, number: 1, approved_by: ids.meena, snapshot: {}, diff: {} }).select("id").single()).data!.id;
      const { data: obs } = await a.from("obligations").select("*").eq("workspace_id", WS).in("review_state", ["accepted", "edited"]);
      for (const o of obs!) {
        const { private_uploaders, reviewed_status, reviewed_trust, ...obligation } = o;
        void reviewed_status; void reviewed_trust;
        const { data: ev } = await a.from("evidence").select("event_id, quote, relation, verified").eq("obligation_id", o.id).order("id");
        const item = { obligation, evidence: ev };
        const ins = await a.from("version_items").insert({
          version_id: v1, workspace_id: WS, obligation_id: o.id, access_level: o.access_level, private_uploaders, item, item_hash: "format-1-hash",
        });
        expect(ins.error).toBeNull();
      }
      await review(as.arun, O("O4"), "edit", "Corrected", { due_text: "by 20 April" });
      expect((await ready()).error).toBeNull();
      const v2 = (await approve()).data as string;
      const diff = (await as.meena.from("versions").select("diff").eq("id", v2).single()).data!.diff;
      expect(diff).toMatchObject({ previous_version: v1, added: [], removed: [], changed: [O("O4")] });
    });
  });
});
