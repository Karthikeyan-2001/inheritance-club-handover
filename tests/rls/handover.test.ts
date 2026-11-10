import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_WORKSPACE, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import { admin, cleanup, hasEnv, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const O = (k: string) => byKey(OBLIGATIONS, k).id;
const WS = DEMO_WORKSPACE.id;

describe.skipIf(!hasEnv)("handover: acknowledgements and sealed placeholders", () => {
  let as: Record<Viewer, Client>;
  let ids: Record<Viewer, string>;
  let version: string;

  beforeAll(async () => {
    ids = await resetDemo();
    as = await signInAll();
    // resetDemo does not approve; make version 1 the way the review flow does.
    expect((await as.arun.rpc("mark_ready", { p_workspace: WS, p_reason: "Ready" })).error).toBeNull();
    const a = await as.meena.rpc("approve_version", { p_workspace: WS, p_reason: "Approved" });
    expect(a.error).toBeNull();
    version = a.data as string;
  });
  afterAll(async () => {
    await cleanup();
  });

  const ack = (c: Client, who: string, obligation: string, action: "accept" | "question" | "decline", note: string | null = null) =>
    c.from("acks").insert({ version_id: version, obligation_id: obligation, user_id: who, action, note });

  it("the incoming lead can answer an item they can read; the latest answer wins", async () => {
    expect((await ack(as.kavya, ids.kavya, O("O1"), "question", "Which hall?")).error).toBeNull();
    expect((await ack(as.kavya, ids.kavya, O("O1"), "accept")).error).toBeNull();
    const { data } = await as.kavya.from("latest_acks").select("action").eq("version_id", version).eq("obligation_id", O("O1"));
    expect(data).toEqual([{ action: "accept" }]);
  });

  it("a question or a decline needs a note", async () => {
    for (const action of ["question", "decline"] as const) {
      const r = await ack(as.kavya, ids.kavya, O("O1"), action, "  ");
      expect(r.error?.message, action).toMatch(/note is required/);
    }
  });

  it("nobody else can answer, and nobody can answer as someone else", async () => {
    for (const v of ["arun", "meena", "divya", "member"] as const) {
      expect((await ack(as[v], ids[v], O("O1"), "accept")).error, v).not.toBeNull();
    }
    expect((await ack(as.kavya, ids.arun, O("O1"), "accept")).error).not.toBeNull();
  });

  it("an item the incoming lead cannot read cannot be answered", async () => {
    // O6 is the advisor's private item: it is in the version, but not readable by Kavya.
    expect((await ack(as.kavya, ids.kavya, O("O6"), "accept")).error).not.toBeNull();
  });

  it("answers are immutable", async () => {
    const { data } = await admin().from("acks").select("id").limit(1).single();
    expect((await admin().from("acks").update({ note: "x" }).eq("id", data!.id)).error?.message).toMatch(/immutable/);
    expect((await admin().from("acks").delete().eq("id", data!.id)).error?.message).toMatch(/immutable/);
  });

  it("each answer writes an audit row with the actor, the action and the note as the reason", async () => {
    await ack(as.kavya, ids.kavya, O("O4"), "decline", "We cannot return them in time");
    const { data } = await as.meena.from("audit_log").select("actor, action, reason, obligation_id").eq("action", "ack_decline").eq("obligation_id", O("O4"));
    expect(data).toEqual([{ actor: ids.kavya, action: "ack_decline", reason: "We cannot return them in time", obligation_id: O("O4") }]);
  });

  it("the outgoing lead and advisor read the incoming lead's answers; the others do not", async () => {
    for (const v of ["arun", "meena"] as const) {
      const { data } = await as[v].from("latest_acks").select("obligation_id").eq("version_id", version);
      expect((data ?? []).length, v).toBeGreaterThan(0);
    }
    for (const v of ["divya", "member"] as const) {
      const { data } = await as[v].from("latest_acks").select("obligation_id").eq("version_id", version);
      expect(data ?? [], v).toEqual([]);
    }
  });

  it("only reviewers add placeholders, and every member can read them without any source text", async () => {
    const ins = (c: Client) => c.from("sealed_items").insert({ workspace_id: WS, obligation_id: O("O6"), holder_role: "advisor", topic_label: "Second dispute" });
    expect((await ins(as.divya)).error).not.toBeNull();
    expect((await ins(as.kavya)).error).not.toBeNull();
    expect((await ins(as.meena)).error).toBeNull();
    const { data } = await as.kavya.from("sealed_items").select("*").eq("topic_label", "Second dispute");
    expect(data).toHaveLength(1);
    expect(Object.keys(data![0]).sort()).toEqual(["approved_by", "holder_role", "id", "obligation_id", "topic_label", "workspace_id"]);
  });
});
