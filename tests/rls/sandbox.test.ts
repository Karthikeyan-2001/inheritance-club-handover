import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USERS, type DemoUserKey } from "../../src/lib/demo/demo-users.ts";
import { DEMO_WORKSPACE, EVENTS, OBLIGATIONS } from "../../src/lib/demo/fixture.ts";
import type { Db } from "../../src/lib/demo/load-club.ts";
import {
  MAX_NEW_SANDBOXES_PER_HOUR,
  ORPHAN_GRACE_MINUTES,
  SandboxLimitError,
  createSandbox,
  purgeOne,
  purgeSandboxes,
  sandboxEmail,
  sandboxPassword,
  type Sandbox,
} from "../../src/lib/demo/sandbox.ts";
import { admin, anon, cleanup, env, hasEnv, resetDemo, signIn } from "./support.ts";

// "Load demo club": each visitor's copy is its own workspace with its own four accounts, built
// through the same triggers and functions as the shared club, and invisible to everyone else.
describe.skipIf(!hasEnv)("demo copies (Phase 10)", () => {
  const secret = "rls-test-sandbox-secret";
  let one: Sandbox;
  let two: Sandbox;
  const made: string[] = [];

  async function signInCopy(copy: Sandbox, key: DemoUserKey): Promise<Db> {
    const c = anon();
    const email = sandboxEmail(copy.workspaceId, key);
    const { error } = await c.auth.signInWithPassword({ email, password: sandboxPassword(secret, email) });
    if (error) throw new Error(`sign in ${key}: ${error.message}`);
    return c;
  }

  async function build(): Promise<Sandbox> {
    const copy = await createSandbox({
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

  beforeAll(async () => {
    await resetDemo();
    one = await build();
    two = await build();
  });

  afterAll(async () => {
    const a = admin();
    for (const id of made) {
      const { data } = await a.from("demo_sandboxes").select("id, user_ids").eq("id", id).maybeSingle();
      if (data) await purgeOne(a, data);
    }
    await cleanup();
  });

  it("builds the whole club with four accounts and version 1 approved", async () => {
    const a = admin();
    const { data: ws } = await a.from("workspaces").select("name, is_demo, sandbox_expires_at").eq("id", one.workspaceId).single();
    expect(ws?.is_demo).toBe(false);
    expect(new Date(ws!.sandbox_expires_at!).getTime()).toBe(one.expiresAt.getTime());

    const { data: members } = await a.from("memberships").select("role, user_id").eq("workspace_id", one.workspaceId);
    expect(members?.map((m) => m.role).sort()).toEqual(DEMO_USERS.map((u) => u.role).sort());

    const count = async (table: "events" | "obligations" | "versions" | "releases") =>
      (await a.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", one.workspaceId)).count;
    expect(await count("events")).toBe(EVENTS.length);
    expect(await count("obligations")).toBe(OBLIGATIONS.length);
    expect(await count("versions")).toBe(1);
    expect(await count("releases")).toBe(1);

    const { data: row } = await a.from("demo_sandboxes").select("workspace_id, user_ids").eq("id", one.workspaceId).single();
    expect(row?.workspace_id).toBe(one.workspaceId);
    expect(row?.user_ids.sort()).toEqual(Object.values(one.users).sort());
  });

  it("gives every copy its own rows, never the fixture's ids", async () => {
    const a = admin();
    const { data } = await a.from("events").select("id").eq("workspace_id", one.workspaceId);
    const fixtureIds = new Set(EVENTS.map((e) => e.id));
    expect(data?.some((e) => fixtureIds.has(e.id))).toBe(false);
  });

  it("lets each account of a copy sign in, and RLS applies per role inside it", async () => {
    const arun = await signInCopy(one, "arun");
    const kavya = await signInCopy(one, "kavya");
    const divya = await signInCopy(one, "divya");
    const meena = await signInCopy(one, "meena");
    const levels = async (c: Db) => new Set((await c.from("events").select("access_level")).data?.map((e) => e.access_level));
    expect(await levels(meena)).toEqual(new Set(["everyone", "committee", "finance", "private"]));
    expect((await levels(divya)).has("private")).toBe(false);
    expect((await levels(kavya)).has("finance")).toBe(false);
    // The incoming lead reads approved versions, not the working ledger.
    expect((await kavya.from("obligations").select("id")).data).toEqual([]);
    expect((await kavya.from("version_items").select("obligation_id")).data?.length).toBeGreaterThan(0);
    expect((await arun.from("obligations").select("id")).data?.length).toBeGreaterThan(0);
  });

  it("keeps copies apart from each other and from the shared club", async () => {
    const meenaOne = await signInCopy(one, "meena");
    const { data: wss } = await meenaOne.from("workspaces").select("id");
    expect(wss?.map((w) => w.id)).toEqual([one.workspaceId]);
    for (const table of ["events", "obligations", "version_items", "audit_log"] as const) {
      const { data } = await meenaOne.from(table).select("workspace_id");
      expect(new Set(data?.map((r) => r.workspace_id))).toEqual(new Set([one.workspaceId]));
    }

    const sharedMeena = await signIn("meena");
    const { data: shared } = await sharedMeena.from("events").select("workspace_id");
    expect(new Set(shared?.map((r) => r.workspace_id))).toEqual(new Set([DEMO_WORKSPACE.id]));
  });

  it("does not let one copy's password open another copy's account", async () => {
    const c = anon();
    const { error } = await c.auth.signInWithPassword({
      email: sandboxEmail(two.workspaceId, "meena"),
      password: sandboxPassword(secret, sandboxEmail(one.workspaceId, "meena")),
    });
    expect(error).not.toBeNull();
  });

  it("does not open a copy's account with the shared demo password", async () => {
    const c = anon();
    const { error } = await c.auth.signInWithPassword({ email: sandboxEmail(one.workspaceId, "arun"), password: env!.demoPassword });
    expect(error).not.toBeNull();
  });

  it("hides the bookkeeping table and the expiry from members' writes", async () => {
    const arun = await signInCopy(one, "arun");
    const { data, error } = await arun.from("demo_sandboxes").select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    await arun.from("workspaces").update({ sandbox_expires_at: "2099-01-01T00:00:00Z" }).eq("id", one.workspaceId);
    const { data: ws } = await admin().from("workspaces").select("sandbox_expires_at").eq("id", one.workspaceId).single();
    expect(new Date(ws!.sandbox_expires_at!).getTime()).toBe(one.expiresAt.getTime());
  });

  it("refuses a new copy when too many were started in the last hour", async () => {
    const a = admin();
    const fakes = Array.from({ length: MAX_NEW_SANDBOXES_PER_HOUR }, () => ({
      id: crypto.randomUUID(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }));
    expect((await a.from("demo_sandboxes").insert(fakes)).error).toBeNull();
    try {
      await expect(build()).rejects.toBeInstanceOf(SandboxLimitError);
    } finally {
      await a.from("demo_sandboxes").delete().in("id", fakes.map((f) => f.id));
    }
  });

  it("lets a visitor delete their own copy; its accounts are purged after the grace period", async () => {
    const arun = await signInCopy(two, "arun");
    const del = await arun.rpc("delete_workspace", { p_workspace: two.workspaceId, p_reason: "done with the demo" });
    expect(del.error).toBeNull();
    const a = admin();
    const { data: row } = await a.from("demo_sandboxes").select("workspace_id").eq("id", two.workspaceId).single();
    expect(row?.workspace_id).toBeNull();

    // Within the grace period a row without a workspace is left alone (it may be being built).
    await purgeSandboxes(a, new Date(), 50);
    expect((await a.from("demo_sandboxes").select("id").eq("id", two.workspaceId)).data).toHaveLength(1);

    const later = new Date(Date.now() + (ORPHAN_GRACE_MINUTES + 1) * 60_000);
    const res = await purgeSandboxes(a, later, 50);
    expect(res.failed).toBe(0);
    expect((await a.from("demo_sandboxes").select("id").eq("id", two.workspaceId)).data).toHaveLength(0);
    await expect(signInCopy(two, "kavya")).rejects.toThrow();
  });

  it("deletes an expired copy with everything in it and its accounts", async () => {
    const a = admin();
    const res = await purgeSandboxes(a, new Date(one.expiresAt.getTime() + 1000), 50);
    expect(res.purged).toBeGreaterThanOrEqual(1);
    expect((await a.from("workspaces").select("id").eq("id", one.workspaceId)).data).toHaveLength(0);
    expect((await a.from("events").select("id", { count: "exact", head: true }).eq("workspace_id", one.workspaceId)).count).toBe(0);
    for (const id of Object.values(one.users)) {
      const { data } = await a.auth.admin.getUserById(id);
      expect(data.user).toBeNull();
    }
    // The shared club is untouched.
    expect((await a.from("workspaces").select("id").eq("id", DEMO_WORKSPACE.id)).data).toHaveLength(1);
  });

});
