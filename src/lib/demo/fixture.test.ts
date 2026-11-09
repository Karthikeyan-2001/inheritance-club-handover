import { describe, expect, it } from "vitest";
import { levelRank } from "../access";
import { DEMO_USERS } from "./demo-users";
import { EVENTS, EVIDENCE, SOURCES, byKey } from "./fixture";

// Same normalisation the quote verifier will use: case and whitespace insensitive.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

describe("demo fixture", () => {
  it("every evidence quote is a verbatim substring of its cited event", () => {
    for (const ev of EVIDENCE) {
      const event = byKey(EVENTS, ev.event);
      expect(norm(event.text), `${ev.key} -> ${ev.event}`).toContain(norm(ev.quote));
    }
  });

  it("no event is less restricted than its source file", () => {
    for (const e of EVENTS) {
      const s = byKey(SOURCES, e.source);
      expect(levelRank(e.access_level), e.key).toBeGreaterThanOrEqual(levelRank(s.access_level));
    }
  });

  it("ids are unique across the fixture", () => {
    const ids = [...SOURCES, ...EVENTS, ...EVIDENCE].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("demo accounts use the reserved example.com domain and cover four roles", () => {
    expect(DEMO_USERS.every((u) => u.email.endsWith("@example.com"))).toBe(true);
    expect(new Set(DEMO_USERS.map((u) => u.role)).size).toBe(4);
  });
});
