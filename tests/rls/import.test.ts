import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/hash.ts";
import { parseUpload } from "../../src/lib/parsers/index.ts";
import { DEMO_WORKSPACE } from "../../src/lib/demo/fixture.ts";
import { cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const WS = DEMO_WORKSPACE.id;
const mini = (f: string) => new Uint8Array(readFileSync(`data/scenarios/mini/${f}`));
const DM = new TextEncoder().encode(
  "02/03/2026, 7:10 pm - Arun: Sir, I will return the oscilloscope by Friday.\n02/03/2026, 7:12 pm - Bala: Ok, register la sign pannunga.\n",
);

type Level = "everyone" | "committee" | "finance" | "private";

async function importAs(c: Client, filename: string, bytes: Uint8Array, level: Level) {
  const parsed = await parseUpload(filename, bytes);
  const type = filename.endsWith(".txt") ? "whatsapp" : filename.endsWith(".json") ? "trello" : "minutes";
  const res = await c.rpc("import_source", {
    p_workspace: WS,
    p_type: type,
    p_filename: filename,
    p_access: level,
    p_sha256: sha256Hex(bytes),
    p_summary: parsed.summary,
    p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
    p_reason: "test import",
  });
  return { ...res, parsed };
}

const eventsOf = async (c: Client, sourceId: string) =>
  (await c.from("events").select("id, text, ts, meta, access_level").eq("source_id", sourceId)).data ?? [];

describe.skipIf(!hasEnv)("import_source: files and events under RLS", () => {
  let as: Record<Viewer, Client>;
  const ids: Record<string, string> = {};
  const parsedCount: Record<string, number> = {};

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
    for (const [f, level] of [["whatsapp-committee.txt", "committee"], ["trello-board.json", "committee"], ["minutes.md", "finance"]] as const) {
      const r = await importAs(as.arun, f, mini(f), level);
      if (r.error) throw new Error(`${f}: ${r.error.message}`);
      ids[f] = r.data as string;
      parsedCount[f] = r.parsed.events.length;
    }
  });
  afterAll(cleanup);

  it("stores every parsed event, with the summary and file metadata", async () => {
    for (const f of Object.keys(ids)) {
      expect((await eventsOf(as.meena, ids[f])).length, f).toBe(parsedCount[f]);
    }
    const { data } = await as.arun.from("sources").select("event_count, read_summary, uploaded_by, sha256").eq("id", ids["whatsapp-committee.txt"]).single();
    expect(data?.event_count).toBe(parsedCount["whatsapp-committee.txt"]);
    expect(data?.read_summary).toMatchObject({ sourceType: "whatsapp", dropped: { system: 3, deleted: 1, media: 1 } });
    expect(data?.sha256).toBe(sha256Hex(mini("whatsapp-committee.txt")));
  });

  it("keeps IST instants exactly and preserves parser metadata", async () => {
    const trello = await eventsOf(as.arun, ids["trello-board.json"]);
    const done = trello.find((e) => e.text.startsWith('Moved card "Send certificates'))!;
    expect(new Date(done.ts!).toISOString()).toBe("2026-03-16T04:00:00.000Z"); // 09:30 IST
    expect(done.meta).toMatchObject({ movedToDone: true, to: "Done" });
  });

  it("each role sees exactly the files its level allows", async () => {
    const visible = async (v: Viewer) =>
      (await as[v].from("sources").select("filename").in("id", Object.values(ids))).data?.map((s) => s.filename).sort();
    expect(await visible("meena")).toEqual(["minutes.md", "trello-board.json", "whatsapp-committee.txt"]);
    expect(await visible("divya")).toEqual(["minutes.md", "trello-board.json", "whatsapp-committee.txt"]);
    expect(await visible("kavya")).toEqual(["trello-board.json", "whatsapp-committee.txt"]);
    expect(await visible("member")).toEqual([]);
    expect(await eventsOf(as.kavya, ids["minutes.md"])).toEqual([]);
    expect((await as.kavya.from("events").select("id").ilike("text", "%₹2,400%")).data).toEqual([]);
  });

  it("only the outgoing lead and advisor can import", async () => {
    for (const v of ["kavya", "divya", "member"] as const) {
      const r = await importAs(as[v], `x-${v}.txt`, new TextEncoder().encode(`01/01/2026, 9:00 am - A: hello ${v}`), "committee");
      expect(r.error?.message, v).toMatch(/only the outgoing lead or the advisor/);
    }
    const r = await importAs(as.meena, "advisor-notes.md", new TextEncoder().encode("## 2026-01-02: Note\n- ok"), "committee");
    expect(r.error).toBeNull();
  });

  it("refuses the same file twice", async () => {
    const r = await importAs(as.arun, "again.txt", mini("whatsapp-committee.txt"), "committee");
    expect(r.error?.code).toBe("23505");
  });

  it("validates its inputs", async () => {
    const bad = await as.arun.rpc("import_source", {
      p_workspace: WS, p_type: "whatsapp", p_filename: " ", p_access: "committee",
      p_sha256: "nothex", p_summary: {}, p_events: [], p_reason: "x",
    });
    expect(bad.error).not.toBeNull();
    const notArray = await as.arun.rpc("import_source", {
      p_workspace: WS, p_type: "whatsapp", p_filename: "a.txt", p_access: "committee",
      p_sha256: "a".repeat(64), p_summary: {}, p_events: { not: "an array" }, p_reason: "x",
    });
    expect(notArray.error?.message).toMatch(/JSON array/);
  });

  it("writes an audit row for the import, readable only by reviewers", async () => {
    const q = (c: Client) => c.from("audit_log").select("action, reason, target_type").eq("target_id", ids["whatsapp-committee.txt"]);
    expect((await q(as.meena)).data).toEqual([{ action: "import", reason: "test import", target_type: "sources" }]);
    expect((await q(as.arun)).data).toHaveLength(1);
    expect((await q(as.kavya)).data).toEqual([]);
  });
});

describe.skipIf(!hasEnv)("private uploads", () => {
  let as: Record<Viewer, Client>;
  let arunDm: string;
  let meenaDm: string;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
    const a = await importAs(as.arun, "WhatsApp Chat with Bala.txt", DM, "private");
    if (a.error) throw new Error(a.error.message);
    arunDm = a.data as string;
    const m = await importAs(as.meena, "WhatsApp Chat with HoD.txt", new TextEncoder().encode("03/03/2026, 10:00 am - Dr. Meena: Confidential matter about the hall."), "private");
    if (m.error) throw new Error(m.error.message);
    meenaDm = m.data as string;
  });
  afterAll(cleanup);

  it("a private file is readable by its uploader and the advisor only", async () => {
    expect(await eventsOf(as.arun, arunDm)).toHaveLength(2);
    expect(await eventsOf(as.meena, arunDm)).toHaveLength(2);
    expect(await eventsOf(as.divya, arunDm)).toEqual([]);
    expect(await eventsOf(as.kavya, arunDm)).toEqual([]);
  });

  it("the outgoing lead cannot read the advisor's private file, or its audit row", async () => {
    expect(await eventsOf(as.arun, meenaDm)).toEqual([]);
    expect((await as.arun.from("sources").select("id").eq("id", meenaDm)).data).toEqual([]);
    expect((await as.arun.from("audit_log").select("id").eq("target_id", meenaDm)).data).toEqual([]);
    expect((await as.meena.from("audit_log").select("id").eq("target_id", meenaDm)).data).toHaveLength(1);
  });

  it("names from private files only appear to roles that can read them", async () => {
    const names = async (v: Viewer) => ((await as[v].rpc("event_authors", { p_workspace: WS })).data ?? []).map((a) => a.author);
    expect(await names("arun")).toContain("Bala");
    expect(await names("kavya")).not.toContain("Bala");
    expect(await names("arun")).not.toContain("Dr. Meena");
  });
});

describe.skipIf(!hasEnv)("remove_source and the protected demo club", () => {
  let as: Record<Viewer, Client>;
  let fileId: string;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
    const r = await importAs(as.arun, "whatsapp-committee.txt", mini("whatsapp-committee.txt"), "committee");
    if (r.error) throw new Error(r.error.message);
    fileId = r.data as string;
  });
  afterAll(cleanup);

  it("needs a reason, and refuses roles that may not remove the file", async () => {
    expect((await as.arun.rpc("remove_source", { p_source: fileId, p_reason: " " })).error?.message).toMatch(/reason is required/);
    expect((await as.kavya.rpc("remove_source", { p_source: fileId, p_reason: "nope" })).error?.message).toMatch(/not allowed/);
    expect((await as.divya.rpc("remove_source", { p_source: fileId, p_reason: "nope" })).error?.message).toMatch(/not allowed/);
    expect(await eventsOf(as.arun, fileId)).not.toHaveLength(0);
  });

  it("the uploader removes the file, its events go with it, and the removal is audited", async () => {
    expect((await as.arun.rpc("remove_source", { p_source: fileId, p_reason: "wrong export" })).error).toBeNull();
    expect(await eventsOf(as.meena, fileId)).toEqual([]);
    const { data } = await as.meena.from("audit_log").select("action, reason").eq("target_id", fileId).order("id");
    expect(data).toEqual([
      { action: "import", reason: "test import" },
      { action: "remove_source", reason: "wrong export" },
    ]);
  });

  it("the demo club cannot be deleted by any user", async () => {
    for (const v of ["arun", "meena"] as const) {
      const { error } = await as[v].rpc("delete_workspace", { p_workspace: WS, p_reason: "try" });
      expect(error?.message, v).toMatch(/shared demo club cannot be deleted/);
    }
    const { count } = await as.meena.from("obligations").select("*", { count: "exact", head: true });
    expect(count).toBe(6);
  });
});
