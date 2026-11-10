import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoUserKey } from "../../src/lib/demo/demo-users.ts";
import type { FrozenClub } from "../../src/lib/demo/frozen-club.ts";
import type { Db } from "../../src/lib/demo/load-club.ts";
import { CLUB_NAMES, createSandbox, purgeOne, sandboxEmail, sandboxPassword, yearClub, type ClubKind, type Sandbox } from "../../src/lib/demo/sandbox.ts";
import { admin, anon, cleanup, hasEnv, resetDemo } from "./support.ts";

// Phase 13: the two kinds of copy a visitor can start, built through the same triggers and
// functions as everything else. The year club is the frozen real-model build; the empty club
// has only its four people.
describe.skipIf(!hasEnv)("demo copies: the built year club and the empty club (Phase 13)", () => {
  const secret = "rls-test-sandbox-secret";
  const made: string[] = [];
  let year: Sandbox;
  let empty: Sandbox;
  let club: FrozenClub;
  let buildMs = 0;

  async function build(kind: ClubKind): Promise<Sandbox> {
    const copy = await createSandbox({
      club: kind,
      admin: admin(),
      secret,
      signIn: async (_key, email, password) => {
        const c = anon();
        const { error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`sign in: ${error.message}`);
        return c;
      },
    });
    made.push(copy.workspaceId);
    return copy;
  }

  async function as(copy: Sandbox, key: DemoUserKey): Promise<Db> {
    const c = anon();
    const email = sandboxEmail(copy.workspaceId, key);
    const { error } = await c.auth.signInWithPassword({ email, password: sandboxPassword(secret, email) });
    if (error) throw new Error(`sign in ${key}: ${error.message}`);
    return c;
  }

  beforeAll(async () => {
    await resetDemo();
    club = await yearClub();
    const t = Date.now();
    year = await build("year");
    buildMs = Date.now() - t;
    empty = await build("empty");
  }, 120_000);

  afterAll(async () => {
    const a = admin();
    for (const id of made) {
      const { data } = await a.from("demo_sandboxes").select("id, user_ids").eq("id", id).maybeSingle();
      if (data) await purgeOne(a, data);
    }
    await cleanup();
  }, 120_000);

  it("builds the year club well within a serverless step", () => {
    expect(year.club).toBe("year");
    // The server action has 60 seconds; the hosted database is slower than local, so keep a wide margin.
    expect(buildMs).toBeLessThan(20_000);
  });

  it("holds every message in file order, and every item with the status, level and conflicts of the build", async () => {
    const a = admin();
    const { data: ws } = await a.from("workspaces").select("name").eq("id", year.workspaceId).single();
    expect(ws?.name).toBe(CLUB_NAMES.year);
    const { data: sources } = await a.from("sources").select("id, filename").eq("workspace_id", year.workspaceId);
    for (const s of club.sources) {
      const id = sources!.find((x) => x.filename === s.filename)!.id;
      const texts: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await a.from("events").select("text").eq("source_id", id).order("seq").range(from, from + 999);
        texts.push(...(data ?? []).map((e) => e.text));
        if (!data || data.length < 1000) break;
      }
      expect(texts, s.filename).toEqual(s.events.map((e) => e.text));
    }

    const { data: items } = await a.from("obligations").select("description, status, access_level, review_state").eq("workspace_id", year.workspaceId);
    expect(items).toHaveLength(club.obligations.length);
    const got = (items ?? []).map((o) => [o.description, o.status, o.access_level, o.review_state].join(" | ")).sort();
    const want = club.obligations.map((o) => [o.description, o.status, o.access_level, o.review_state].join(" | ")).sort();
    expect(got).toEqual(want);
    const { count } = await a.from("docket_entries").select("*", { count: "exact", head: true }).eq("workspace_id", year.workspaceId);
    expect(count).toBe(club.docket.length);
  });

  it("approved version 1 with the accepted items, signed off by the copy's own people", async () => {
    const a = admin();
    const { data: versions } = await a.from("versions").select("id, number").eq("workspace_id", year.workspaceId);
    expect(versions?.map((v) => v.number)).toEqual([1]);
    const { count } = await a.from("version_items").select("*", { count: "exact", head: true }).eq("version_id", versions![0].id);
    expect(count).toBe(club.obligations.filter((o) => o.review_state === "accepted").length);
    const { data: audit } = await a.from("audit_log").select("action").eq("workspace_id", year.workspaceId).in("action", ["mark_ready", "approve_version"]);
    expect((audit ?? []).map((x) => x.action).sort()).toEqual(["approve_version", "mark_ready"]);
  });

  it("each role reads what it may: Kavya the approved version without finance or private items, Divya finance, Arun not the advisor's chat", async () => {
    const kavya = await as(year, "kavya");
    const { data: vi } = await kavya.from("version_items").select("access_level");
    expect((vi ?? []).length).toBeGreaterThan(20);
    expect((vi ?? []).every((r) => r.access_level === "everyone" || r.access_level === "committee")).toBe(true);
    expect((await kavya.from("obligations").select("id")).data).toEqual([]);
    const { data: sealed } = await kavya.from("sealed_items").select("topic_label");
    expect((sealed ?? []).map((s) => s.topic_label).sort()).toEqual(club.sealed.map((s) => s.topic_label).sort());

    const divya = await as(year, "divya");
    expect(((await divya.from("obligations").select("access_level")).data ?? []).some((o) => o.access_level === "finance")).toBe(true);

    const arun = await as(year, "arun");
    const { data: files } = await arun.from("sources").select("access_level");
    expect((files ?? []).some((f) => f.access_level === "private")).toBe(false);
    const meena = await as(year, "meena");
    expect(((await meena.from("sources").select("access_level")).data ?? []).some((f) => f.access_level === "private")).toBe(true);
  });

  it("the empty club has its four people and nothing else", async () => {
    const a = admin();
    expect(empty.club).toBe("empty");
    const { data: members } = await a.from("memberships").select("role").eq("workspace_id", empty.workspaceId);
    expect(members?.map((m) => m.role).sort()).toEqual(["advisor", "incoming_lead", "outgoing_lead", "treasurer"]);
    for (const t of ["sources", "events", "obligations", "versions"] as const) {
      const { count } = await a.from(t).select("*", { count: "exact", head: true }).eq("workspace_id", empty.workspaceId);
      expect([t, count]).toEqual([t, 0]);
    }
    const { data: row } = await a.from("demo_sandboxes").select("workspace_id, user_ids").eq("id", empty.workspaceId).single();
    expect(row?.workspace_id).toBe(empty.workspaceId);
    expect(row?.user_ids).toHaveLength(4);
  });
});
