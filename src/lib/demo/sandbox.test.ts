import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_SANDBOXES,
  MAX_NEW_SANDBOXES_PER_HOUR,
  SANDBOX_TTL_HOURS,
  capacityProblem,
  demoKeyFromMetadata,
  readSandboxCookie,
  sandboxEmail,
  sandboxExpiry,
  sandboxPassword,
  signSandboxCookie,
} from "./sandbox";

const WS = "3f2b8c1e-5d4a-4b6f-9e21-0a1b2c3d4e5f";
const SECRET = "test-secret-key";
const NOW = new Date("2026-11-10T10:00:00Z");

describe("sandboxEmail", () => {
  it("names one account per role and copy", () => {
    expect(sandboxEmail(WS, "kavya")).toBe(`kavya+${WS}@example.com`);
  });

  it("refuses anything but a workspace id", () => {
    expect(() => sandboxEmail("../x", "arun")).toThrow();
    expect(() => sandboxEmail(`${WS}@evil.com`, "arun")).toThrow();
  });
});

describe("sandboxPassword", () => {
  it("is stable for an email and secret", () => {
    const email = sandboxEmail(WS, "arun");
    expect(sandboxPassword(SECRET, email)).toBe(sandboxPassword(SECRET, email));
  });

  it("differs per account and per secret", () => {
    const a = sandboxPassword(SECRET, sandboxEmail(WS, "arun"));
    expect(sandboxPassword(SECRET, sandboxEmail(WS, "meena"))).not.toBe(a);
    expect(sandboxPassword("other-secret", sandboxEmail(WS, "arun"))).not.toBe(a);
  });

  it("fits bcrypt's 72-byte limit and never leaks the secret", () => {
    const p = sandboxPassword(SECRET, sandboxEmail(WS, "arun"));
    expect(p.length).toBeLessThanOrEqual(72);
    expect(p.length).toBeGreaterThanOrEqual(40);
    expect(p).not.toContain(SECRET);
  });

  it("refuses an empty secret", () => {
    expect(() => sandboxPassword("", "a@example.com")).toThrow();
  });
});

describe("sandbox cookie", () => {
  const expires = sandboxExpiry(NOW);

  it("round-trips the workspace and expiry", () => {
    const v = signSandboxCookie(SECRET, WS, expires);
    const r = readSandboxCookie(SECRET, v, NOW);
    expect(r?.workspaceId).toBe(WS);
    expect(r?.expiresAt.getTime()).toBe(Math.floor(expires.getTime() / 1000) * 1000);
  });

  it("refuses a cookie signed with another secret", () => {
    expect(readSandboxCookie(SECRET, signSandboxCookie("other", WS, expires), NOW)).toBeNull();
  });

  it("refuses a tampered workspace or expiry", () => {
    const [, exp, mac] = signSandboxCookie(SECRET, WS, expires).split(".");
    const other = "00000000-0000-4000-8000-000000000001";
    expect(readSandboxCookie(SECRET, `${other}.${exp}.${mac}`, NOW)).toBeNull();
    expect(readSandboxCookie(SECRET, `${WS}.${Number(exp) + 3600}.${mac}`, NOW)).toBeNull();
  });

  it("refuses an expired cookie", () => {
    const v = signSandboxCookie(SECRET, WS, expires);
    expect(readSandboxCookie(SECRET, v, new Date(expires.getTime() + 1000))).toBeNull();
  });

  it("refuses garbage and missing values", () => {
    expect(readSandboxCookie(SECRET, undefined, NOW)).toBeNull();
    expect(readSandboxCookie(SECRET, "", NOW)).toBeNull();
    expect(readSandboxCookie(SECRET, "a.b.c", NOW)).toBeNull();
    expect(readSandboxCookie(SECRET, `${WS}.1.2.3`, NOW)).toBeNull();
    expect(readSandboxCookie("", signSandboxCookie(SECRET, WS, expires), NOW)).toBeNull();
  });
});

describe("sandboxExpiry", () => {
  it("is the TTL after now", () => {
    expect(sandboxExpiry(NOW).getTime() - NOW.getTime()).toBe(SANDBOX_TTL_HOURS * 3600_000);
  });
});

describe("capacityProblem", () => {
  it("allows a copy under both limits", () => {
    expect(capacityProblem(0, 0)).toBeNull();
    expect(capacityProblem(MAX_ACTIVE_SANDBOXES - 1, MAX_NEW_SANDBOXES_PER_HOUR - 1)).toBeNull();
  });

  it("says full when too many are active, busy when too many are new", () => {
    expect(capacityProblem(MAX_ACTIVE_SANDBOXES, 0)).toBe("full");
    expect(capacityProblem(0, MAX_NEW_SANDBOXES_PER_HOUR)).toBe("busy");
    expect(capacityProblem(MAX_ACTIVE_SANDBOXES, MAX_NEW_SANDBOXES_PER_HOUR)).toBe("full");
  });
});

describe("demoKeyFromMetadata", () => {
  it("reads a known role key", () => {
    expect(demoKeyFromMetadata({ demo_key: "divya" })).toBe("divya");
  });

  it("ignores unknown or missing keys", () => {
    expect(demoKeyFromMetadata({ demo_key: "mallory" })).toBeNull();
    expect(demoKeyFromMetadata({})).toBeNull();
    expect(demoKeyFromMetadata(null)).toBeNull();
    expect(demoKeyFromMetadata("arun")).toBeNull();
  });
});
