// Items built from a private file, by the person who uploaded it (migration 0018). Found by the
// Phase 12 end-to-end test: the outgoing lead's own private chat yielded nothing when he built
// the ledger, because the new row was unreadable to him for the moment before its first quote.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_WORKSPACE } from "../../src/lib/demo/fixture.ts";
import { sha256Hex } from "../../src/lib/hash.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const PROMISE = "I'll speak to the scholarship committee about the appeal by 20 October.";
const RULE = "The scholarship committee meets every semester, and the HoD has to sign the list first.";
const MEENA_PROMISE = "I'll ask the dean about the medical leave rules by Friday.";

async function importPrivate(c: Client, filename: string, lines: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const parsed = await parseUpload(filename, bytes);
  const { data, error } = await c.rpc("import_source", {
    p_workspace: WS, p_type: parsed.summary.sourceType, p_filename: filename, p_access: "private", p_sha256: sha256Hex(bytes),
    p_summary: parsed.summary, p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
    p_reason: "test import",
  });
  if (error) throw new Error(`${filename}: ${error.message}`);
  return data as string;
}

describe.skipIf(!hasEnv)("items from a private file, stored by its uploader", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  let commitment: string;
  let duty: string;
  let meenaItem: string;

  const eventIn = async (c: Client, source: string, starts: string) =>
    (await c.from("events").select("id").eq("source_id", source).like("text", `${starts}%`).single()).data!.id;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    const mine = await importPrivate(as.arun, "WhatsApp Chat with Prof. Iyer.txt", [
      `05/10/2026, 7:45 pm - Arun: ${PROMISE}`,
      `05/10/2026, 7:50 pm - Arun: ${RULE}`,
    ]);
    const add = await as.arun.rpc("add_extracted_commitment", {
      p_workspace: WS, p_event: await eventIn(as.arun, mine, "I'll speak"), p_quote: PROMISE, p_owed_by: "Arun",
      p_owed_to: "Joel", p_deliverable: "Speak to the scholarship committee about the appeal", p_due_text: "by 20 October",
    });
    if (add.error) throw new Error(`add_extracted_commitment: ${add.error.message}`);
    commitment = add.data![0].obligation_id;
    const d = await as.arun.rpc("add_recurring_duty", {
      p_workspace: WS, p_description: "Send the scholarship list to the committee", p_period: "semester", p_cadence: "every semester",
      p_approval: "HoD's signature", p_approver: "HoD", p_lead_time: "", p_owed_by: "", p_next_due: null as never, p_start_by: null as never, p_next_due_basis: "",
      p_quotes: [{ event_id: await eventIn(as.arun, mine, "The scholarship"), quote: RULE, relation: "supports" }],
    });
    if (d.error) throw new Error(`add_recurring_duty: ${d.error.message}`);
    duty = d.data![0].obligation_id;

    const hers = await importPrivate(as.meena, "WhatsApp Chat with HoD.txt", [`06/10/2026, 9:00 am - Dr. Meena: ${MEENA_PROMISE}`]);
    const m = await as.meena.rpc("add_extracted_commitment", {
      p_workspace: WS, p_event: await eventIn(as.meena, hers, "I'll ask"), p_quote: MEENA_PROMISE, p_owed_by: "Dr. Meena",
      p_owed_to: "Dean", p_deliverable: "Ask the dean about the leave rules", p_due_text: "by Friday",
    });
    if (m.error) throw new Error(`advisor's add_extracted_commitment: ${m.error.message}`);
    meenaItem = m.data![0].obligation_id;
  });
  afterAll(cleanup);

  const reads = async (v: Viewer, id: string) => ((await as[v].from("obligations").select("id").eq("id", id)).data ?? []).length === 1;

  it("the outgoing lead stores a commitment and a duty from his own private chat, private to him", async () => {
    const { data } = await as.arun.from("obligations").select("id, access_level, private_uploaders, trust_state").in("id", [commitment, duty]);
    expect(data).toHaveLength(2);
    for (const o of data ?? []) expect(o).toMatchObject({ access_level: "private", private_uploaders: [ids.arun], trust_state: "sourced" });
  });

  it("only he and the advisor read them; the treasurer, incoming lead and members do not", async () => {
    for (const id of [commitment, duty]) {
      expect(await reads("arun", id)).toBe(true);
      expect(await reads("meena", id)).toBe(true);
      for (const v of ["divya", "kavya", "member"] as const) expect([v, await reads(v, id)]).toEqual([v, false]);
    }
  });

  it("the advisor's own private item stays hers: the outgoing lead cannot read it", async () => {
    expect(await reads("meena", meenaItem)).toBe(true);
    expect(await reads("arun", meenaItem)).toBe(false);
    const { data } = await as.meena.from("obligations").select("private_uploaders").eq("id", meenaItem).single();
    expect(data?.private_uploaders).toEqual([ids.meena]);
  });

  it("the audit rows for the new items carry the item's private level and uploader", async () => {
    const { data } = await as.meena.from("audit_log").select("access_level, private_uploaders").eq("obligation_id", commitment);
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const r of data ?? []) expect(r).toMatchObject({ access_level: "private", private_uploaders: [ids.arun] });
    expect(((await as.divya.from("audit_log").select("id").eq("obligation_id", commitment)).data ?? []).length).toBe(0);
  });

  it("a private item inserted with no quote and someone else's uploader is unreadable to its inserter (it narrows, never widens)", async () => {
    const id = crypto.randomUUID();
    const ins = await as.arun.from("obligations").insert({
      id, workspace_id: WS, kind: "commitment", description: "Placeholder written by hand", status: "open", trust_state: "gap",
      access_level: "private", private_uploaders: [ids.meena], review_state: "draft",
    });
    expect(ins.error).toBeNull();
    expect(await reads("arun", id)).toBe(false);
    expect(await reads("divya", id)).toBe(false);
  });
});
