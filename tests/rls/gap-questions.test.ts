// Phase 15: gap questions (migration 0022). The outgoing lead's answer becomes a message in a
// "Stated by the outgoing lead" file, and that message is cited like any other record.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_WORKSPACE, DOCKET_ENTRIES, EVENTS, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import { statementText } from "../../src/lib/questions.ts";
import { admin, cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const O = (k: string) => byKey(OBLIGATIONS, k).id;
const E = (k: string) => byKey(EVENTS, k).id;
const D1 = byKey(DOCKET_ENTRIES, "D1").id;

type Answer = {
  p_obligation: string;
  p_question: string;
  p_answer: string;
  p_level: "everyone" | "committee" | "finance" | "private";
  p_detail?: string;
  p_approver?: string;
  p_next_due?: string;
  p_start_by?: string;
  p_entry?: string;
};

describe.skipIf(!hasEnv)("gap questions: answers become stated, sourced records", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  // Synthetic items made for this test, on the shared fixture's messages.
  let kits: string; // a promise with no follow-up, readable by everyone
  let posters: string; // another one, for "I don't know"
  let renewal: string; // a duty with no approver and no next date

  const answer = (c: Client, a: Answer) => c.rpc("answer_gap", a);
  const item = async (id: string) =>
    (await admin().from("obligations").select("status, trust_state, access_level, approver, approval_required, next_due, start_by, next_due_basis, review_state, reviewed_status, reviewed_trust").eq("id", id).single()).data!;

  async function makeItem(row: Record<string, unknown>, event: string, quote: string): Promise<string> {
    const a = admin();
    const ins = await a.from("obligations").insert({ workspace_id: WS, review_state: "accepted", access_level: "everyone", ...row } as never).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    const id = ins.data.id;
    const ev = await a.from("evidence").insert({ obligation_id: id, event_id: event, quote, relation: "supports", verified: true });
    if (ev.error) throw new Error(ev.error.message);
    // As the seed does: accepted with what the row now says (the gotcha on re-review baselines).
    const now = await item(id);
    await a.from("obligations").update({ reviewed_status: now.status, reviewed_trust: now.trust_state }).eq("id", id);
    return id;
  }

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const checked = new Date().toISOString();
    kits = await makeItem({ kind: "commitment", description: "Set up the demo kits.", owed_by: "Arun", owed_to: "Volunteers", status: "no_evidence", fulfilment_checked_at: checked }, E("E3"), "Remember HoD permission letter first");
    posters = await makeItem({ kind: "commitment", description: "Print the workshop posters", owed_by: "Arun", owed_to: "the club", status: "no_evidence", fulfilment_checked_at: checked }, E("E1"), "Book IoT lab for Feb workshop");
    renewal = await makeItem({ kind: "recurring", description: "Renew the lab booking every semester", owed_by: "Club committee", status: "open", lead_time: "two weeks before" }, E("E1"), "needed every semester");
    // Version 1, as the review flow makes it.
    expect((await as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: "Ready" })).error).toBeNull();
    expect((await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "Approved" })).error).toBeNull();
  });
  afterAll(async () => {
    await cleanup();
  });

  it("only the outgoing lead answers", async () => {
    for (const v of ["meena", "kavya", "divya", "member"] as const) {
      const r = await answer(as[v], { p_obligation: kits, p_question: "followup", p_answer: "done", p_level: "everyone" });
      expect(r.error, v).not.toBeNull();
    }
    expect((await admin().from("gap_answers").select("id")).data).toEqual([]);
  });

  it("refuses an answer less restricted than the item, an answer that does not fit, and a question that does not apply", async () => {
    // O2 is committee-level: an answer naming it cannot be readable by everyone.
    const low = await answer(as.arun, { p_obligation: O("O2"), p_question: "conflict", p_answer: "done", p_level: "everyone", p_entry: D1 });
    expect(low.error?.message).toMatch(/cannot be readable by more people than the item/);
    expect((await answer(as.arun, { p_obligation: kits, p_question: "followup", p_answer: "date", p_level: "everyone" })).error?.message).toMatch(/does not fit/);
    // O1 is a duty with an approver: no approver question.
    expect((await answer(as.arun, { p_obligation: O("O1"), p_question: "approver", p_answer: "no_approval", p_level: "everyone" })).error?.message).toMatch(/no longer applies/);
    // A conflict question must name its conflict.
    expect((await answer(as.arun, { p_obligation: O("O2"), p_question: "conflict", p_answer: "done", p_level: "committee" })).error).not.toBeNull();
    expect((await admin().from("gap_answers").select("id")).data).toEqual([]);
  });

  it("an answer of done becomes a verified message from the lead, and the trust and status rules move the item", async () => {
    const before = await item(kits);
    expect([before.status, before.trust_state]).toEqual(["no_evidence", "sourced"]);
    const r = await answer(as.arun, { p_obligation: kits, p_question: "followup", p_answer: "done", p_level: "everyone", p_detail: "  Kits were ready  on the day. " });
    expect(r.error).toBeNull();
    const eventId = r.data as string;

    const ev = (await admin().from("events").select("text, author, access_level, sources(type, filename, uploaded_by)").eq("id", eventId).single()).data!;
    expect(ev.text).toBe("Done: Set up the demo kits. Kits were ready on the day.");
    expect(ev.text).toBe(statementText({ question: "followup", answer: "done", description: "Set up the demo kits.", detail: "  Kits were ready  on the day. " }));
    expect(ev.author).toBe("Arun");
    expect(ev.access_level).toBe("everyone");
    expect(ev.sources).toEqual({ type: "statement", filename: "Answers to gap questions (Everyone)", uploaded_by: ids.arun });

    const evidence = (await admin().from("evidence").select("relation, quote, verified, inferred").eq("obligation_id", kits).eq("event_id", eventId)).data;
    expect(evidence).toEqual([{ relation: "fulfils", quote: ev.text, verified: true, inferred: false }]);

    const after = await item(kits);
    // A promise in one file and "done" in another: two independent records (the Phase 6 rule).
    expect([after.status, after.trust_state]).toEqual(["fulfilled", "corroborated"]);
    // Accepted with other values, so it needs review again; the answer did not accept it.
    expect([after.review_state, after.reviewed_status]).toEqual(["accepted", "no_evidence"]);
  });

  it("the same question cannot be answered twice", async () => {
    const r = await answer(as.arun, { p_obligation: kits, p_question: "followup", p_answer: "not_done", p_level: "everyone" });
    expect(r.error?.message).toMatch(/no longer applies/);
    expect((await admin().from("gap_answers").select("id").eq("obligation_id", kits)).data).toHaveLength(1);
  });

  it("writes one review audit row with the actor, the reason, and the item before and after", async () => {
    const { data } = await as.meena.from("audit_log").select("actor, action, reason, before, after, access_level").eq("action", "answer_gap").eq("obligation_id", kits);
    expect(data).toHaveLength(1);
    const row = data![0];
    expect([row.actor, row.reason, row.access_level]).toEqual([ids.arun, "Kits were ready on the day.", "everyone"]);
    expect((row.before as Record<string, unknown>).status).toBe("no_evidence");
    expect((row.after as Record<string, unknown>)).toMatchObject({ status: "fulfilled", trust_state: "corroborated", question: "followup", answer: "done" });
  });

  it("answers are read by whoever reads the working ledger (not the incoming lead or members), and nobody writes them directly", async () => {
    expect((await as.arun.from("gap_answers").select("question, answer").eq("obligation_id", kits)).data).toEqual([{ question: "followup", answer: "done" }]);
    expect((await as.meena.from("gap_answers").select("id").eq("obligation_id", kits)).data).toHaveLength(1);
    // The treasurer reads the working ledger (migration 0014), so she reads answers on items she can read.
    expect((await as.divya.from("gap_answers").select("id").eq("obligation_id", kits)).data).toHaveLength(1);
    for (const v of ["kavya", "member"] as const) {
      expect((await as[v].from("gap_answers").select("id")).data ?? [], v).toEqual([]);
    }
    const { data: one } = await admin().from("gap_answers").select("*").eq("obligation_id", kits).single();
    const forged = { ...one!, id: undefined, seq: undefined, obligation_id: posters };
    delete forged.id;
    delete forged.seq;
    expect((await as.arun.from("gap_answers").insert(forged as never)).error).not.toBeNull();
    expect((await as.arun.from("gap_answers").update({ answer: "not_done" }).eq("obligation_id", kits).select("id")).data ?? []).toEqual([]);
    expect((await as.arun.from("gap_answers").delete().eq("obligation_id", kits).select("id")).data ?? []).toEqual([]);
  });

  it("\"I don't know\" is a verified note and leaves the item as it was; it can be answered later, once", async () => {
    const r = await answer(as.arun, { p_obligation: posters, p_question: "followup", p_answer: "unknown", p_level: "everyone" });
    expect(r.error).toBeNull();
    const notes = (await admin().from("context_items").select("kind, text, quote, verified, access_level").eq("obligation_id", posters)).data;
    expect(notes).toEqual([{ kind: "risk", text: "Arun does not know whether it was done.", quote: "Not known whether it was done: Print the workshop posters.", verified: true, access_level: "everyone" }]);
    expect((await admin().from("evidence").select("id").eq("obligation_id", posters)).data).toHaveLength(1);
    expect((await item(posters)).status).toBe("no_evidence");
    expect((await answer(as.arun, { p_obligation: posters, p_question: "followup", p_answer: "unknown", p_level: "everyone" })).error?.message).toMatch(/already answered/);
    // The same file holds every everyone-level answer.
    const { data: files } = await admin().from("sources").select("filename, event_count").eq("workspace_id", WS).eq("type", "statement");
    expect(files).toEqual([{ filename: "Answers to gap questions (Everyone)", event_count: 2 }]);
  });

  it("not done keeps the promise owed, at a chosen, more restricted level that raises the item", async () => {
    const r = await answer(as.arun, { p_obligation: posters, p_question: "followup", p_answer: "not_done", p_level: "committee" });
    expect(r.error).toBeNull();
    const after = await item(posters);
    expect([after.status, after.access_level]).toEqual(["open", "committee"]);
    const ev = (await admin().from("events").select("access_level, sources(filename)").eq("id", r.data as string).single()).data!;
    expect([ev.access_level, ev.sources?.filename]).toEqual(["committee", "Answers to gap questions (Committee)"]);
    // A member (everyone only) cannot read the committee answer or the raised item.
    expect((await as.member.from("events").select("id").eq("id", r.data as string)).data).toEqual([]);
  });

  it("a conflict answer is one more record: the item stays contradicted until the advisor rules", async () => {
    const r = await answer(as.arun, { p_obligation: O("O2"), p_question: "conflict", p_answer: "not_done", p_level: "committee", p_entry: D1, p_detail: "Checked with the speakers." });
    expect(r.error).toBeNull();
    const after = await item(O("O2"));
    expect([after.status, after.trust_state]).toEqual(["contradicted", "contradicted"]);
    expect((await as.meena.from("gap_answers").select("docket_entry_id, answer").eq("obligation_id", O("O2"))).data).toEqual([{ docket_entry_id: D1, answer: "not_done" }]);
    expect((await answer(as.arun, { p_obligation: O("O2"), p_question: "conflict", p_answer: "done", p_level: "committee", p_entry: D1 })).error?.message).toMatch(/already answered/);
    // Once ruled, the question no longer applies at all.
    expect((await as.meena.rpc("rule_conflict", { p_entry: D1, p_ruling: "not_done", p_reason: "The speakers say so" })).error).toBeNull();
    const late = await answer(as.arun, { p_obligation: O("O2"), p_question: "conflict", p_answer: "unknown", p_level: "committee", p_entry: D1 });
    expect(late.error?.message).toMatch(/no longer applies/);
  });

  it("a duty's approver and next date are filled from the lead's statement, which is also its evidence", async () => {
    expect((await answer(as.arun, { p_obligation: renewal, p_question: "approver", p_answer: "approver", p_level: "everyone", p_approver: "" })).error?.message).toMatch(/name who gives/);
    const a = await answer(as.arun, { p_obligation: renewal, p_question: "approver", p_answer: "approver", p_level: "everyone", p_approver: "Lab in-charge" });
    expect(a.error).toBeNull();
    expect((await answer(as.arun, { p_obligation: renewal, p_question: "date", p_answer: "date", p_level: "everyone", p_next_due: "2027-01-15", p_start_by: "2027-01-20" })).error?.message).toMatch(/on or before/);
    const d = await answer(as.arun, { p_obligation: renewal, p_question: "date", p_answer: "date", p_level: "everyone", p_next_due: "2027-01-15", p_start_by: "2027-01-01" });
    expect(d.error).toBeNull();
    const after = await item(renewal);
    expect([after.approver, after.approval_required, after.next_due, after.start_by, after.next_due_basis]).toEqual(["Lab in-charge", "Approval", "2027-01-15", "2027-01-01", "Stated by the outgoing lead"]);
    const quotes = (await admin().from("evidence").select("relation, quote").eq("obligation_id", renewal).neq("event_id", E("E1")).order("quote")).data;
    expect(quotes).toEqual([
      { relation: "supports", quote: "Needs approval from Lab in-charge: Renew the lab booking every semester." },
      { relation: "supports", quote: "Next due on 15 Jan 2027: Renew the lab booking every semester." },
    ]);
    // Review state is untouched by an answer; field changes are audited as plain updates with the reason.
    expect(after.review_state).toBe("accepted");
    const { data: upd } = await as.meena.from("audit_log").select("action, reason").eq("obligation_id", renewal).eq("target_type", "obligations").eq("action", "update");
    expect((upd ?? []).length).toBeGreaterThanOrEqual(2);
    for (const u of upd ?? []) expect(u.reason).toMatch(/^Gap question answered by the outgoing lead/);
  });

  it("a private answer is the lead's own: the advisor reads it, nobody else", async () => {
    const lab = await makeItem({ kind: "commitment", description: "Return the soldering iron", owed_by: "Arun", owed_to: "Mr. Bala", status: "no_evidence", fulfilment_checked_at: new Date().toISOString() }, E("E3"), "last sem they rejected us without it");
    const r = await answer(as.arun, { p_obligation: lab, p_question: "followup", p_answer: "done", p_level: "private" });
    expect(r.error).toBeNull();
    const id = r.data as string;
    expect((await as.arun.from("events").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await as.meena.from("events").select("id").eq("id", id)).data).toHaveLength(1);
    for (const v of ["kavya", "divya", "member"] as const) expect((await as[v].from("events").select("id").eq("id", id)).data ?? [], v).toEqual([]);
    expect((await item(lab)).access_level).toBe("private");
  });

  it("after review and approval, the incoming lead reads the stated answer in the next version", async () => {
    // Items whose status or trust moved need accepting again before the lead can mark ready.
    for (const id of [kits, posters, O("O2")]) {
      const r = await as.arun.rpc("review_obligation", { p_id: id, p_action: "accept", p_reason: "Checked the answer" });
      expect(r.error, id).toBeNull();
    }
    const flagged = (await admin().from("obligations").select("id, review_state, status, trust_state, reviewed_status, reviewed_trust").eq("workspace_id", WS)).data!
      .filter((o) => ["accepted", "edited"].includes(o.review_state) && (o.status !== o.reviewed_status || o.trust_state !== o.reviewed_trust));
    for (const o of flagged) expect((await as.arun.rpc("review_obligation", { p_id: o.id, p_action: "accept", p_reason: "Checked" })).error).toBeNull();
    expect((await as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: "Answers checked" })).error).toBeNull();
    const v = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "Approved with the answers" });
    expect(v.error).toBeNull();

    const { data: vi } = await as.kavya.from("version_items").select("item").eq("version_id", v.data as string).eq("obligation_id", kits).single();
    const evidence = (vi!.item as { evidence: { relation: string; quote: string; event_id: string }[] }).evidence;
    const stated = evidence.find((e) => e.relation === "fulfils")!;
    expect(stated.quote).toBe("Done: Set up the demo kits. Kits were ready on the day.");
    expect((vi!.item as { obligation: { status: string } }).obligation.status).toBe("fulfilled");
    // She can open the message and see where it comes from.
    const ev = (await as.kavya.from("events").select("author, sources(type)").eq("id", stated.event_id).single()).data!;
    expect([ev.author, ev.sources?.type]).toEqual(["Arun", "statement"]);
    // The diff names the item as changed.
    const diff = (await as.kavya.from("versions").select("diff").eq("id", v.data as string).single()).data!.diff as { changed: string[] };
    expect(diff.changed).toContain(kits);
    // The note from "I don't know" travels with the version too.
    const notes = (await as.kavya.from("version_context_items").select("text").eq("version_id", v.data as string).eq("obligation_id", posters)).data;
    expect((notes ?? []).map((n) => n.text)).toEqual(["Arun does not know whether it was done."]);
  });

  it("removing the statement file removes its answers, and the question comes back", async () => {
    const { data: file } = await admin().from("sources").select("id").eq("workspace_id", WS).eq("type", "statement").eq("access_level", "everyone").single();
    expect((await as.arun.rpc("remove_source", { p_source: file!.id, p_reason: "Withdrawn" })).error).toBeNull();
    expect((await admin().from("gap_answers").select("id").eq("obligation_id", kits)).data).toEqual([]);
    expect((await item(kits)).status).toBe("no_evidence");
  });
});
