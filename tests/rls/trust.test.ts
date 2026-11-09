// The trust rule, links between items and the docket, under RLS (migration 0011).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/hash.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { DEMO_WORKSPACE, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import type { Json } from "../../src/lib/supabase/database.types.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const enc = (s: string) => new TextEncoder().encode(s);
const chat = (lines: string[]) => enc(lines.join("\n"));

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

const eventIn = async (c: Client, source: string, starts: string) => {
  const { data, error } = await c.from("events").select("id").eq("source_id", source).like("text", `${starts}%`).single();
  if (error) throw new Error(`event "${starts}": ${error.message}`);
  return data.id;
};

async function commit(c: Client, event: string, quote: string, deliverable: string) {
  const { data, error } = await c.rpc("add_extracted_commitment", {
    p_workspace: WS, p_event: event, p_quote: quote, p_owed_by: "Arun", p_owed_to: "Brightwave Labs", p_deliverable: deliverable, p_due_text: "",
  });
  if (error) throw new Error(error.message);
  return data![0].obligation_id;
}

const follow = (c: Client, obligation: string, evidence: Json[]) =>
  c.rpc("record_followup", { p_workspace: WS, p_obligation: obligation, p_evidence: evidence, p_context: [] });

const state = async (c: Client, id: string) =>
  (await c.from("obligations").select("trust_state, status, access_level").eq("id", id).maybeSingle()).data;

describe.skipIf(!hasEnv)("the trust rule follows the evidence", () => {
  let as: Record<Viewer, Client>;
  const src: Record<string, string> = {};
  let item: string;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
    src.promise = await importAs(as.arun, "letters.txt", chat([
      "01/03/2026, 9:00 am - Arun: I will send the thank-you letters to Brightwave Labs by 10 March.",
      "11/03/2026, 9:00 am - Arun: Thank-you letters sent to Brightwave Labs.",
    ]), "committee");
    src.volunteers = await importAs(as.arun, "volunteers.txt", chat(["12/03/2026, 6:00 pm - Priya: Brightwave confirmed they got the thank-you letters."]), "committee");
    src.complaints = await importAs(as.arun, "complaints.txt", chat(["15/03/2026, 7:00 pm - Kavya: Brightwave says the thank-you letters never arrived."]), "committee");
    item = await commit(as.arun, await eventIn(as.arun, src.promise, "I will send"), "I will send the thank-you letters to Brightwave Labs", "Send thank-you letters");
  });
  afterAll(cleanup);

  it("a single record is sourced; the same person confirming in the same chat is still sourced", async () => {
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "sourced", status: "open" });
    const r = await follow(as.arun, item, [{ event_id: await eventIn(as.arun, src.promise, "Thank-you letters sent"), quote: "Thank-you letters sent to Brightwave Labs", relation: "fulfils" }]);
    expect(r.data?.[0]).toMatchObject({ evidence_added: 1, status: "fulfilled" });
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "sourced", status: "fulfilled" });
  });

  it("a second, independent record corroborates it", async () => {
    await follow(as.arun, item, [{ event_id: await eventIn(as.arun, src.volunteers, "Brightwave confirmed"), quote: "Brightwave confirmed they got the thank-you letters", relation: "fulfils" }]);
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "corroborated", status: "fulfilled" });
  });

  it("no client can set trust by hand", async () => {
    const { error } = await as.arun.from("obligations").update({ trust_state: "gap" }).eq("id", item);
    expect(error).toBeNull();
    expect((await state(as.arun, item))?.trust_state).toBe("corroborated");
  });

  it("done against not done is contradicted, and opens a docket entry with both quotes", async () => {
    await follow(as.arun, item, [{ event_id: await eventIn(as.arun, src.complaints, "Brightwave says"), quote: "the thank-you letters never arrived", relation: "contradicts" }]);
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "contradicted", status: "contradicted" });

    const { data } = await as.kavya.from("docket_entries").select("origin, quote_a, quote_b, summary, ruling").eq("obligation_id", item);
    expect(data).toEqual([{
      origin: "rule",
      quote_a: "Brightwave confirmed they got the thank-you letters", // the latest stated "done"
      quote_b: "the thank-you letters never arrived",
      summary: "WhatsApp, 12 Mar 2026: says it was done. WhatsApp, 15 Mar 2026: says it was not.",
      ruling: null,
    }]);
    expect((await as.member.from("docket_entries").select("id").eq("obligation_id", item)).data).toEqual([]);

    const audit = await as.meena.from("audit_log").select("action, reason, obligation_id").eq("target_type", "docket_entries").eq("obligation_id", item);
    expect(audit.data).toEqual([{ action: "insert", reason: "Conflict found by the trust rule: one record says it was done, another says it was not", obligation_id: item }]);
  });

  it("removing the file with the 'not done' claim settles it again and closes the entry", async () => {
    expect((await as.arun.rpc("remove_source", { p_source: src.complaints, p_reason: "wrong chat" })).error).toBeNull();
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "corroborated", status: "fulfilled" });
    expect((await as.meena.from("docket_entries").select("id").eq("obligation_id", item)).data).toEqual([]);
    const audit = await as.meena.from("audit_log").select("action, reason").eq("target_type", "docket_entries").eq("obligation_id", item).order("id");
    // The entry went with the message it cited, so the removal's reason is recorded.
    expect(audit.data?.at(-1)).toEqual({ action: "delete", reason: "wrong chat" });
  });

  it("with every file behind it removed, the item is a gap and its status says no evidence", async () => {
    await as.arun.rpc("remove_source", { p_source: src.volunteers, p_reason: "test" });
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "sourced", status: "fulfilled" });
    await as.arun.rpc("remove_source", { p_source: src.promise, p_reason: "test" });
    expect(await state(as.arun, item)).toMatchObject({ trust_state: "gap", status: "no_evidence" });
  });
});

describe.skipIf(!hasEnv)("links between items, and borrowing evidence only downwards", () => {
  let as: Record<Viewer, Client>;
  let committeeItem: string; // the chat promise, done by Arun's own word
  let financeItem: string; // the minutes restating it, then saying it was not done
  let privateItem: string; // Dr. Meena's own note of it

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
    const c = await importAs(as.arun, "hall.txt", chat([
      "01/04/2026, 9:00 am - Arun: I will book the seminar hall for the alumni talk by 5 April.",
      "06/04/2026, 10:00 am - Arun: Booked the seminar hall for the alumni talk.",
    ]), "committee");
    const m = await importAs(as.arun, "finance.md", enc(
      "# Minutes\n\n## 2026-04-08: Finance sync\n\n- Arun to book the seminar hall for the alumni talk.\n\n## 2026-04-10: Finance sync\n\n- The seminar hall was not booked; the office has no request on file.",
    ), "finance");
    const p = await importAs(as.meena, "meena.txt", chat(["02/04/2026, 8:00 am - Dr. Meena: I will check that Arun books the seminar hall for the alumni talk."]), "private");

    committeeItem = await commit(as.arun, await eventIn(as.arun, c, "I will book"), "I will book the seminar hall for the alumni talk", "Book the seminar hall");
    await follow(as.arun, committeeItem, [{ event_id: await eventIn(as.arun, c, "Booked"), quote: "Booked the seminar hall for the alumni talk", relation: "fulfils" }]);
    financeItem = await commit(as.arun, await eventIn(as.arun, m, "2026-04-08"), "Arun to book the seminar hall for the alumni talk", "Book the seminar hall");
    await follow(as.arun, financeItem, [{ event_id: await eventIn(as.arun, m, "2026-04-10"), quote: "The seminar hall was not booked", relation: "contradicts" }]);
    privateItem = await commit(as.meena, await eventIn(as.meena, p, "I will check"), "I will check that Arun books the seminar hall", "Check the hall booking");
  });
  afterAll(cleanup);

  const link = (c: Client, a: string, b: string, verdict = "same", method = "rule") =>
    c.rpc("link_obligations", { p_workspace: WS, p_a: a, p_b: b, p_verdict: verdict, p_method: method, p_score: 0.8 });

  it("starts from each item's own evidence", async () => {
    expect(await state(as.arun, committeeItem)).toMatchObject({ trust_state: "sourced", status: "fulfilled", access_level: "committee" });
    expect(await state(as.arun, financeItem)).toMatchObject({ trust_state: "sourced", status: "open", access_level: "finance" });
  });

  it("refuses links from non-reviewers, to itself, across kinds, or to items the caller cannot read", async () => {
    expect((await link(as.kavya, committeeItem, financeItem)).error?.message).toMatch(/only the outgoing lead or the advisor/);
    expect((await link(as.arun, committeeItem, committeeItem)).error?.message).toMatch(/cannot be linked to itself/);
    expect((await link(as.arun, committeeItem, byKey(OBLIGATIONS, "O1").id)).error?.message).toMatch(/same kind/);
    expect((await link(as.arun, committeeItem, privateItem)).error?.message).toMatch(/item not found/);
    expect((await link(as.arun, committeeItem, financeItem, "merged")).error?.message).toMatch(/unknown link verdict/);
  });

  it("a possible match shares nothing", async () => {
    const r = await link(as.arun, committeeItem, financeItem, "possible", "model");
    expect(r.data?.[0]).toMatchObject({ created: true, verdict: "possible" });
    expect((await state(as.arun, financeItem))?.trust_state).toBe("sourced");
  });

  it("as the same item, the finance copy borrows the committee evidence, but not the other way round", async () => {
    const r = await link(as.arun, financeItem, committeeItem, "same", "model");
    expect(r.data?.[0]).toMatchObject({ created: false, verdict: "same" });
    // Finance: its own "not booked" against the committee chat's "booked".
    expect(await state(as.divya, financeItem)).toMatchObject({ trust_state: "contradicted" });
    // Committee: unchanged, so the incoming lead is told nothing that comes from the finance minutes.
    expect(await state(as.kavya, committeeItem)).toMatchObject({ trust_state: "sourced", status: "fulfilled" });
    expect((await link(as.arun, committeeItem, financeItem, "possible")).data?.[0]).toMatchObject({ verdict: "same" }); // never downgraded
  });

  it("a link, and the docket entry it caused, are visible only to readers of both sides", async () => {
    const links = async (v: Viewer) => (await as[v].from("obligation_links").select("verdict").or(`a.eq.${financeItem},b.eq.${financeItem}`)).data ?? [];
    expect(await links("divya")).toEqual([{ verdict: "same" }]);
    expect(await links("arun")).toEqual([{ verdict: "same" }]);
    expect(await links("kavya")).toEqual([]);
    expect(await links("member")).toEqual([]);

    const docket = async (v: Viewer) => (await as[v].from("docket_entries").select("quote_a, quote_b").eq("obligation_id", financeItem)).data ?? [];
    expect(await docket("divya")).toEqual([{ quote_a: "Booked the seminar hall for the alumni talk", quote_b: "The seminar hall was not booked" }]);
    expect(await docket("kavya")).toEqual([]);
    expect((await as.kavya.from("docket_entries").select("id").eq("obligation_id", committeeItem)).data).toEqual([]);
  });

  it("audits links at the level of the more restricted item", async () => {
    const { data } = await as.meena.from("audit_log").select("action, reason, access_level, obligation_id").eq("target_type", "obligation_links").order("id");
    expect(data).toEqual([
      { action: "insert", reason: "Matched by the language model; the verdict is the only thing it returned", access_level: "finance", obligation_id: financeItem },
      { action: "update", reason: "Matched by the language model; the verdict is the only thing it returned", access_level: "finance", obligation_id: financeItem },
    ]);
  });

  it("a private item borrows from a committee item; its link and audit stay with its readers", async () => {
    expect((await link(as.meena, privateItem, committeeItem)).error).toBeNull();
    expect(await state(as.meena, privateItem)).toMatchObject({ trust_state: "corroborated", access_level: "private" });
    expect((await as.meena.from("obligation_links").select("id").or(`a.eq.${privateItem},b.eq.${privateItem}`)).data).toHaveLength(1);
    expect((await as.arun.from("obligation_links").select("id").or(`a.eq.${privateItem},b.eq.${privateItem}`)).data).toEqual([]);
    expect((await as.arun.from("audit_log").select("id").eq("obligation_id", privateItem)).data).toEqual([]);
    expect(await state(as.arun, committeeItem)).toMatchObject({ trust_state: "sourced" });
  });

  it("removing a link settles both items again", async () => {
    const { error } = await as.arun.from("obligation_links").delete().or(`a.eq.${financeItem},b.eq.${financeItem}`);
    expect(error).toBeNull();
    expect(await state(as.divya, financeItem)).toMatchObject({ trust_state: "sourced" });
    expect((await as.divya.from("docket_entries").select("id").eq("obligation_id", financeItem)).data).toEqual([]);
    const audit = await as.meena.from("audit_log").select("action, reason").eq("target_type", "docket_entries").eq("obligation_id", financeItem).order("id");
    expect(audit.data?.at(-1)).toEqual({ action: "delete", reason: "The conflict no longer holds: the records no longer say both done and not done" });
  });

  it("a reviewer cannot file a docket entry citing a message they cannot read", async () => {
    const dm = (await as.meena.from("events").select("id").like("text", "I will check that Arun%").single()).data!.id;
    const own = (await as.arun.from("events").select("id").like("text", "Booked the seminar hall%").single()).data!.id;
    const { error } = await as.arun.from("docket_entries").insert({ workspace_id: WS, claim_a_event: own, claim_b_event: dm, summary: "x" });
    expect(error?.code).toBe("42501");
  });
});
