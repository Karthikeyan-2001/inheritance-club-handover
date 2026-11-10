// A visitor's own copy of the SYNTHETIC demo club ("Load demo club").
//
// Each copy is a workspace with four accounts of its own (outgoing lead, advisor, incoming
// lead, treasurer), so one visitor's reviews, approvals and answers never reach another, and
// row-level security applies exactly as for a real club. Copies expire and are deleted.
//
// Accounts have no stored password. Each one's password is an HMAC of its email under a
// server-only secret, so the server can sign a visitor in as any account of *their* copy
// (role switching) without keeping credentials anywhere.
//
// No server-only import: unit and RLS tests import this file. The service-role client, the
// secret and the sign-in are injected by the caller (src/lib/demo/sandbox-server.ts).

import { createHmac, timingSafeEqual } from "node:crypto";
import { DEMO_USERS, isDemoUserKey, type DemoUserKey } from "./demo-users.ts";
import { insertEmptyClub, insertFrozenClub, type FrozenClub } from "./frozen-club.ts";
import { finishClub, freshIds, insertClub, memoSignIn, type Db } from "./load-club.ts";

export const SANDBOX_TTL_HOURS = 24 * 7;
export const MAX_ACTIVE_SANDBOXES = 300;
export const MAX_NEW_SANDBOXES_PER_HOUR = 60;
/** A bookkeeping row with no workspace is left alone this long, so a copy being built is not purged. */
export const ORPHAN_GRACE_MINUTES = 10;
export const SANDBOX_NAME = "Demo Club (SYNTHETIC, your copy)";

/**
 * What a copy starts with:
 *  - "year": a year of the synthetic IoT club's records and the ledger a real model built from
 *    them (frozen, so no model call), with version 1 approved and a few items still drafts;
 *  - "empty": the four people and nothing else, to import the sample files and build it yourself;
 *  - "toy": the small Phase 1 fixture (9 messages), as in the shared club. Used by the tests.
 */
export const CLUB_KINDS = ["year", "empty", "toy"] as const;
export type ClubKind = (typeof CLUB_KINDS)[number];
export const isClubKind = (v: unknown): v is ClubKind => typeof v === "string" && (CLUB_KINDS as readonly string[]).includes(v);

export const CLUB_NAMES: Record<ClubKind, string> = {
  year: "IoT Club, one year (SYNTHETIC, your copy)",
  empty: "Your club (SYNTHETIC, starts empty)",
  toy: SANDBOX_NAME,
};

/** The frozen year club, read only when a copy needs it (it is large). */
export async function yearClub(): Promise<FrozenClub> {
  const mod = await import("./year-club.json", { with: { type: "json" } });
  return mod.default as unknown as FrozenClub;
}
export const SANDBOX_COOKIE = "inheritance_demo_copy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The sign-in email of one account of a copy. example.com never delivers mail. */
export function sandboxEmail(workspaceId: string, key: DemoUserKey): string {
  if (!UUID.test(workspaceId)) throw new Error("not a workspace id");
  return `${key}+${workspaceId}@example.com`;
}

/** The account's password: derived, never stored. 43 characters, within bcrypt's 72 bytes. */
export function sandboxPassword(secret: string, email: string): string {
  if (!secret) throw new Error("no secret");
  return createHmac("sha256", secret).update(`inheritance-sandbox-user:${email}`).digest("base64url");
}

function cookieMac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`inheritance-sandbox-cookie:${payload}`).digest("base64url");
}

/**
 * The "return to your demo club" cookie: workspace id and expiry, signed. It lets a visitor
 * who signed out get back to their copy; it grants nothing once the copy has expired.
 */
export function signSandboxCookie(secret: string, workspaceId: string, expiresAt: Date): string {
  const payload = `${workspaceId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${cookieMac(secret, payload)}`;
}

export function readSandboxCookie(
  secret: string,
  value: string | undefined,
  now: Date,
): { workspaceId: string; expiresAt: Date } | null {
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [workspaceId, exp, mac] = parts;
  if (!UUID.test(workspaceId) || !/^\d{1,12}$/.test(exp)) return null;
  const expected = Buffer.from(cookieMac(secret, `${workspaceId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { workspaceId, expiresAt };
}

export function sandboxExpiry(now: Date): Date {
  return new Date(now.getTime() + SANDBOX_TTL_HOURS * 3600_000);
}

export type CapacityReason = "full" | "busy";

export class SandboxLimitError extends Error {
  constructor(public reason: CapacityReason) {
    super(reason === "full" ? "too many demo copies are active" : "too many demo copies were created in the last hour");
    this.name = "SandboxLimitError";
  }
}

/** Pure: whether another copy may be created now. */
export function capacityProblem(active: number, lastHour: number): CapacityReason | null {
  if (active >= MAX_ACTIVE_SANDBOXES) return "full";
  if (lastHour >= MAX_NEW_SANDBOXES_PER_HOUR) return "busy";
  return null;
}

function must<T>(label: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

export type SandboxDeps = {
  /** Service-role client. Server only. */
  admin: Db;
  /** Server-only secret the account passwords and the cookie are derived from. */
  secret: string;
  now?: () => Date;
  /**
   * Sign in with an email and password and return a client acting as that user. The caller
   * decides which client: the server action passes the visitor's cookie session for Arun, so
   * the visitor ends up signed in as their own outgoing lead.
   */
  signIn: (key: DemoUserKey, email: string, password: string) => Promise<Db>;
};

export type Sandbox = { workspaceId: string; expiresAt: Date; users: Record<DemoUserKey, string>; club: ClubKind };

async function countActive(admin: Db, now: Date): Promise<{ active: number; lastHour: number }> {
  const active = await admin.from("demo_sandboxes").select("id", { count: "exact", head: true })
    .gt("expires_at", now.toISOString());
  if (active.error) throw new Error(`count copies: ${active.error.message}`);
  const recent = await admin.from("demo_sandboxes").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(now.getTime() - 3600_000).toISOString());
  if (recent.error) throw new Error(`count copies: ${recent.error.message}`);
  return { active: active.count ?? 0, lastHour: recent.count ?? 0 };
}

/**
 * Create a visitor's copy: bookkeeping row first (so a copy that fails half-way is still
 * found and purged), then four accounts, then the club as the service role, then the
 * releases and the sign-off of version 1 as the copy's own users. On failure everything
 * created so far is removed.
 */
export async function createSandbox(deps: SandboxDeps & { club?: ClubKind }): Promise<Sandbox> {
  const club = deps.club ?? "toy";
  const now = (deps.now ?? (() => new Date()))();
  const { admin, secret } = deps;
  if (!secret) throw new Error("no secret");

  await purgeSandboxes(admin, now, 3);
  const { active, lastHour } = await countActive(admin, now);
  const problem = capacityProblem(active, lastHour);
  if (problem) throw new SandboxLimitError(problem);

  const workspaceId = crypto.randomUUID();
  const expiresAt = sandboxExpiry(now);
  must("bookkeeping", await admin.from("demo_sandboxes").insert({
    id: workspaceId, expires_at: expiresAt.toISOString(), created_at: now.toISOString(),
  }));

  const userIds: string[] = [];
  try {
    const users = {} as Record<DemoUserKey, string>;
    for (const u of DEMO_USERS) {
      const email = sandboxEmail(workspaceId, u.key);
      const res = await admin.auth.admin.createUser({
        email,
        password: sandboxPassword(secret, email),
        email_confirm: true,
        user_metadata: { name: u.name, demo: true, demo_key: u.key, sandbox: workspaceId, synthetic: true },
      });
      if (res.error || !res.data.user) throw new Error(`create account: ${res.error?.message ?? "no user"}`);
      users[u.key] = res.data.user.id;
      userIds.push(res.data.user.id);
      // Recorded one by one, so a function that dies here leaves at most one account unrecorded.
      must("bookkeeping users", await admin.from("demo_sandboxes").update({ user_ids: userIds }).eq("id", workspaceId));
    }

    const target = { workspaceId, name: CLUB_NAMES[club], sandboxExpiresAt: expiresAt.toISOString(), users };
    const as = memoSignIn((key) => {
      const email = sandboxEmail(workspaceId, key);
      return deps.signIn(key, email, sandboxPassword(secret, email));
    });
    if (club === "toy") {
      const toy = { ...target, isDemo: false, ids: freshIds() };
      await insertClub(admin, toy);
      must("bookkeeping workspace", await admin.from("demo_sandboxes").update({ workspace_id: workspaceId }).eq("id", workspaceId));
      await finishClub(as, toy, { approveFirst: true });
    } else if (club === "year") {
      await insertFrozenClub(admin, await yearClub(), target);
      must("bookkeeping workspace", await admin.from("demo_sandboxes").update({ workspace_id: workspaceId }).eq("id", workspaceId));
      // Version 1, signed off by the club's own people, so the rules and the audit apply.
      must("mark_ready", await (await as("arun")).rpc("mark_ready", { p_workspace: workspaceId, p_reason: "Checked the accepted items against their quotes." }));
      must("approve_version", await (await as("meena")).rpc("approve_version", { p_workspace: workspaceId, p_reason: "Version 1: the committee's handover, checked with the outgoing lead." }));
    } else {
      await insertEmptyClub(admin, target);
      must("bookkeeping workspace", await admin.from("demo_sandboxes").update({ workspace_id: workspaceId }).eq("id", workspaceId));
    }
    // The visitor ends up signed in as the copy's outgoing lead whatever it holds.
    await as("arun");
    return { workspaceId, expiresAt, users, club };
  } catch (err) {
    await purgeOne(admin, { id: workspaceId, user_ids: userIds }).catch(() => {});
    throw err;
  }
}

/** Remove one copy: its workspace (everything in it), its accounts, its bookkeeping row. */
export async function purgeOne(admin: Db, row: { id: string; user_ids: string[] }): Promise<void> {
  // The row id is the workspace id it was created with, so this also catches a copy whose
  // workspace was inserted but not yet recorded.
  must("delete workspace", await admin.rpc("delete_workspace", { p_workspace: row.id, p_reason: "Demo copy expired or deleted" }));
  for (const id of row.user_ids) {
    const res = await admin.auth.admin.deleteUser(id);
    if (res.error && res.error.status !== 404) throw new Error(`delete account: ${res.error.message}`);
  }
  must("delete bookkeeping", await admin.from("demo_sandboxes").delete().eq("id", row.id));
}

export type PurgeResult = { purged: number; failed: number };

/**
 * Remove up to `limit` copies that have expired, or whose workspace a visitor deleted (after
 * a short grace, so a copy still being built is left alone). Oldest first. Idempotent: safe to
 * run twice, or from the cron and a page load at once.
 */
export async function purgeSandboxes(admin: Db, now: Date, limit: number): Promise<PurgeResult> {
  const graceCutoff = new Date(now.getTime() - ORPHAN_GRACE_MINUTES * 60_000).toISOString();
  const res = await admin.from("demo_sandboxes").select("id, user_ids")
    .or(`expires_at.lt.${now.toISOString()},and(workspace_id.is.null,created_at.lt.${graceCutoff})`)
    .order("expires_at", { ascending: true })
    .limit(limit);
  if (res.error) throw new Error(`find expired copies: ${res.error.message}`);
  let purged = 0;
  let failed = 0;
  for (const row of res.data ?? []) {
    try {
      await purgeOne(admin, row);
      purged++;
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}

/** The role key of a signed-in account, from its metadata (set for every demo account). */
export function demoKeyFromMetadata(meta: unknown): DemoUserKey | null {
  if (!meta || typeof meta !== "object") return null;
  const key = (meta as Record<string, unknown>).demo_key;
  return isDemoUserKey(key) ? key : null;
}
