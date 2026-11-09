import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_WORKSPACE, OBLIGATIONS, byKey } from "../../src/lib/demo/fixture.ts";
import { EXPECTED } from "./expected.ts";
import { anon, hasEnv, keys, removeMember, resetDemo, signInAll, type Client, type Viewer } from "./support.ts";

const VIEWERS: Viewer[] = ["meena", "arun", "divya", "kavya", "member"];
const TABLES = Object.keys(EXPECTED) as (keyof typeof EXPECTED)[];

describe.skipIf(!hasEnv)("RLS: each role sees a different slice of the same tables", () => {
  let as: Record<Viewer, Client>;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await removeMember();
  });

  for (const table of TABLES) {
    for (const viewer of VIEWERS) {
      it(`${viewer} reads exactly ${EXPECTED[table][viewer].join(", ") || "nothing"} from ${table}`, async () => {
        const { data, error } = await as[viewer].from(table).select("id");
        expect(error).toBeNull();
        expect(keys(data)).toEqual(EXPECTED[table][viewer]);
      });
    }
  }

  it("the four demo roles (and member) all see different obligations", async () => {
    const sets = await Promise.all(
      VIEWERS.map(async (v) => keys((await as[v].from("obligations").select("id")).data).join(",")),
    );
    expect(new Set(sets).size).toBe(VIEWERS.length);
  });

  it("anonymous visitors read nothing from any table", async () => {
    const c = anon();
    const all = [...TABLES, "workspaces", "memberships", "versions", "version_items", "acks",
      "releases", "audit_log", "jobs", "llm_cache"] as const;
    for (const t of all) {
      const { data } = await c.from(t).select("*").limit(1);
      expect(data ?? [], t).toEqual([]);
    }
  });

  it("members see the workspace and its members, nothing more", async () => {
    const { data } = await as.kavya.from("workspaces").select("id, name");
    expect(data).toEqual([{ id: DEMO_WORKSPACE.id, name: DEMO_WORKSPACE.name }]);
    const m = await as.kavya.from("memberships").select("role");
    expect((m.data ?? []).map((r) => r.role).sort()).toEqual(
      ["advisor", "incoming_lead", "member", "outgoing_lead", "treasurer"],
    );
  });

  it("derived levels: each obligation inherits its most restrictive cited event", async () => {
    const { data } = await as.meena.from("obligations").select("id, access_level, private_uploaders");
    const level = Object.fromEntries((data ?? []).map((o) => [o.id, o.access_level]));
    expect(level[byKey(OBLIGATIONS, "O1").id]).toBe("everyone");
    expect(level[byKey(OBLIGATIONS, "O2").id]).toBe("committee");
    expect(level[byKey(OBLIGATIONS, "O3").id]).toBe("finance");
    expect(level[byKey(OBLIGATIONS, "O4").id]).toBe("private");
    expect(level[byKey(OBLIGATIONS, "O6").id]).toBe("private");
  });
});

describe.skipIf(!hasEnv)("RLS: no leaks", () => {
  let as: Record<Viewer, Client>;

  beforeAll(async () => {
    await resetDemo();
    as = await signInAll();
  });
  afterAll(async () => {
    await removeMember();
  });

  const O = (k: string) => byKey(OBLIGATIONS, k).id;

  it("the outgoing lead cannot read the advisor's private DM, its obligation, evidence or audit trail", async () => {
    const c = as.arun;
    expect((await c.from("obligations").select("id").eq("id", O("O6"))).data).toEqual([]);
    expect((await c.from("evidence").select("id").eq("obligation_id", O("O6"))).data).toEqual([]);
    expect((await c.from("audit_log").select("id").eq("obligation_id", O("O6"))).data).toEqual([]);
    const { data: auditText } = await c.from("audit_log").select("after");
    expect(JSON.stringify(auditText)).not.toContain("Robotics");
    expect(JSON.stringify(auditText)).not.toContain("take it up with the HoD");
  });

  it("the outgoing lead can read audit rows for their own private items", async () => {
    const { data } = await as.arun.from("audit_log").select("id").eq("obligation_id", O("O5"));
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("the incoming lead sees no finance rows anywhere", async () => {
    for (const t of ["sources", "events", "obligations", "context_items"] as const) {
      const { data } = await as.kavya.from(t).select("id").in("access_level", ["finance"]);
      expect(data, t).toEqual([]);
    }
  });

  it("a release shares the obligation and its quote, not the private message itself", async () => {
    const ev = await as.kavya.from("evidence").select("quote").eq("obligation_id", O("O4"));
    expect(ev.data).toEqual([{ quote: "I will return the 6 DHT22 sensors before semester end" }]);
    const events = await as.kavya.from("events").select("id").ilike("text", "%DHT22%");
    expect(events.data).toEqual([]);
  });

  it("sealed placeholders expose only holder and topic, no source text", async () => {
    const { data } = await as.kavya.from("sealed_items").select("*");
    expect(data).toHaveLength(1);
    expect(Object.keys(data![0]).sort()).toEqual(
      ["approved_by", "holder_role", "id", "obligation_id", "topic_label", "workspace_id"],
    );
    expect(data![0]).toMatchObject({ holder_role: "advisor", topic_label: "Hall booking dispute" });
  });

  it("only the advisor and outgoing lead can read the audit log", async () => {
    expect((await as.divya.from("audit_log").select("id")).data).toEqual([]);
    expect((await as.kavya.from("audit_log").select("id")).data).toEqual([]);
    expect((await as.member.from("audit_log").select("id")).data).toEqual([]);
    expect(((await as.meena.from("audit_log").select("id")).data ?? []).length).toBeGreaterThan(0);
  });

  it("roles without review rights cannot write ledger rows", async () => {
    const ins = await as.kavya.from("obligations").insert({
      workspace_id: DEMO_WORKSPACE.id, kind: "commitment", description: "sneaky",
    });
    expect(ins.error?.message).toMatch(/row-level security/);
    const upd = await as.divya.from("obligations").update({ description: "changed" }).eq("id", O("O3")).select("id");
    expect(upd.data).toEqual([]);
  });

  it("the outgoing lead cannot see or edit an item they cannot read", async () => {
    const upd = await as.arun.from("obligations").update({ description: "changed" }).eq("id", O("O6")).select("id");
    expect(upd.data).toEqual([]);
  });
});
