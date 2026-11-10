import { describe, expect, it } from "vitest";
import { levelRank } from "../access";
import { loadScenario } from "../eval/scenario";
import { verifyQuote } from "../pipeline/verify";
import { eventText, parseRef, type FrozenClub } from "./frozen-club";
import raw from "./year-club.json" with { type: "json" };

const club = raw as unknown as FrozenClub;
const levelOfRef = (ref: string) => club.sources.find((s) => s.key === parseRef(ref).source)!.access_level;

describe("the frozen year club (demo copies)", () => {
  it("is synthetic and says how it was built", () => {
    expect(club.synthetic).toBe(true);
    expect(club.built.scenario).toBe("year");
    expect(club.built.model).toMatch(/^claude-/);
  });

  it("holds exactly the scenario's messages, file by file, in file order", async () => {
    const scenario = await loadScenario("year");
    expect(club.sources.map((s) => s.filename).sort()).toEqual(scenario.files.map((f) => f.name).sort());
    for (const s of club.sources) {
      const want = scenario.events.filter((e) => e.file === s.filename);
      expect(s.events.map((e) => e.text), s.filename).toEqual(want.map((e) => e.text));
      expect(s.access_level, s.filename).toBe(scenario.files.find((f) => f.name === s.filename)!.accessLevel);
    }
  });

  it("every quote and every note's quote is verbatim in the message it cites", () => {
    const bad = [
      ...club.evidence.filter((e) => !verifyQuote(e.quote, eventText(club, e.event)).ok).map((e) => `${e.obligation} ${e.event}: ${e.quote}`),
      ...club.context.filter((c) => !verifyQuote(c.quote, eventText(club, c.event)).ok).map((c) => `${c.obligation} ${c.event}: ${c.quote}`),
    ];
    expect(bad).toEqual([]);
  });

  it("every item rests on at least one quote of its own, and every link, docket entry and seal names a real item", () => {
    const keys = new Set(club.obligations.map((o) => o.key));
    for (const o of club.obligations) expect(club.evidence.some((e) => e.obligation === o.key && e.relation === "supports"), o.key).toBe(true);
    for (const l of club.links) expect([keys.has(l.a), keys.has(l.b)]).toEqual([true, true]);
    for (const d of club.docket) expect(keys.has(d.obligation)).toBe(true);
    for (const s of club.sealed) expect(keys.has(s.obligation)).toBe(true);
  });

  it("an item is at least as restricted as every message it cites (provenance), and a private item names its uploader", () => {
    for (const o of club.obligations) {
      const cited = club.evidence.filter((e) => e.obligation === o.key).map((e) => levelOfRef(e.event));
      for (const l of cited) expect(levelRank(o.access_level), o.key).toBeGreaterThanOrEqual(levelRank(l));
      if (o.access_level === "private") expect(o.private_uploaders.length, o.key).toBeGreaterThan(0);
    }
  });

  it("no restricted text of the scenario sits on an item or note readable at a lower level", async () => {
    const { truth } = await loadScenario("year");
    const leaks: string[] = [];
    for (const r of truth.restricted) {
      for (const o of club.obligations) {
        const text = [o.description, o.owed_by, o.owed_to, o.due_text, o.approval_required, o.approver, o.cadence, o.lead_time, ...club.evidence.filter((e) => e.obligation === o.key).map((e) => e.quote)].join(" | ");
        if (levelRank(r.level) > levelRank(o.access_level) && text.includes(r.text)) leaks.push(`${o.key} (${o.access_level}) holds "${r.text}" (${r.level})`);
      }
      for (const c of club.context) {
        const level = levelOfRef(c.event);
        if (levelRank(r.level) > levelRank(level) && `${c.text} ${c.quote}`.includes(r.text)) leaks.push(`note on ${c.obligation} (${level}) holds "${r.text}"`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("leaves some drafts to review, and seals only restricted items with fixed wording", () => {
    expect(club.obligations.filter((o) => o.review_state === "draft").length).toBeGreaterThan(0);
    expect(club.obligations.filter((o) => o.review_state === "accepted").length).toBeGreaterThan(20);
    for (const s of club.sealed) {
      const o = club.obligations.find((x) => x.key === s.obligation)!;
      expect(["finance", "private"]).toContain(o.access_level);
      expect(["A finance matter", "A private matter, held by the advisor"]).toContain(s.topic_label);
    }
  });
});
