import { beforeAll, describe, expect, it } from "vitest";
import { levelRank } from "../access.ts";
import { MemoryLlmCache } from "../llm/cache-memory.ts";
import { FakeProvider } from "../llm/provider-fake.ts";
import type { PipelineEvent } from "../pipeline/extract.ts";
import { fakeHandlers } from "../pipeline/provider.ts";
import { runInMemory, type MemoryResult } from "../pipeline/run-memory.ts";
import { DUTIES_TASK, EXTRACT_TASK } from "../pipeline/tasks.ts";
import { eventFor, loadScenario, scenarioNames, type Scenario } from "./scenario.ts";
import { findLeaks, formatScorecard, scoreRun, type Scorecard } from "./score.ts";

const ENV = { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" };

describe("scenarios", () => {
  it("lists the hand-written and generated scenarios", () => {
    expect(scenarioNames()).toEqual(expect.arrayContaining(["mini", "photo", "year"]));
  });

  it("loads every scenario with each event at its file's level, and private events with their uploader", async () => {
    for (const name of scenarioNames()) {
      const s = await loadScenario(name);
      expect(s.events.length, name).toBeGreaterThan(0);
      for (const e of s.events) {
        expect(e.accessLevel).toBe(s.truth.files[e.file].accessLevel);
        expect(e.uploaderId ?? null).toBe(e.accessLevel === "private" ? s.truth.files[e.file].uploader : null);
      }
      // Every planted quote resolves to a message.
      for (const c of s.truth.commitments) expect(eventFor(s.events, c.quote), `${name} ${c.id}`).toBeDefined();
    }
  });

  it("refuses an unknown scenario by name", async () => {
    await expect(loadScenario("nope")).rejects.toThrow(/No scenario called "nope"/);
  });
});

// A tiny hand-built run, to test the scorer itself.
describe("scoreRun", () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await loadScenario("photo");
  });
  const ev = (q: { file: string; text: string }): PipelineEvent => eventFor(s.events, q)!;
  const commitment = (id: string, q: { file: string; text: string }, over: Partial<MemoryResult["commitments"][number]> = {}): MemoryResult["commitments"][number] => {
    const e = ev(q);
    return {
      id, level: e.accessLevel ?? "everyone", trust: "sourced", status: "no_evidence", evidence: [], context: [],
      candidate: { event: e, quote: q.text, owedBy: "x", owedTo: "y", deliverable: "something", dueText: null },
      ...over,
    };
  };
  const empty = (): MemoryResult => ({ commitments: [], duties: [], links: [], dropped: {}, usage: { inputTokens: 0, outputTokens: 0 }, calls: 0 });

  it("an empty run finds nothing, keeps nothing, and leaks nothing", () => {
    const card = scoreRun(empty(), s);
    expect(card.commitments).toMatchObject({ total: 9, found: 0, statusOk: 0 });
    expect(card.duties).toMatchObject({ total: 4, found: 0 });
    expect(card.precision).toBe(1);
    expect(card.leaks).toEqual([]);
    expect(formatScorecard(card)).toContain("MISSED P1");
  });

  it("counts found items, right and wrong statuses, decoys, restatements and wrong links", () => {
    const t = (id: string) => s.truth.commitments.find((c) => c.id === id)!;
    const res = empty();
    res.commitments.push(
      commitment("a", t("P6").quote, { status: "no_evidence", trust: "sourced" }),
      commitment("b", t("P7").quote, { status: "fulfilled" }), // wrong status
      commitment("c", s.truth.decoys[0]), // a decoy kept
      // A partial quote of the promise still finds it.
      commitment("d", { file: "whatsapp-committee.txt", text: "I'll collect the exhibition prints from Pixel Hub" }, { status: "fulfilled" }),
      // A restatement: linked as the same as P6.
      commitment("e", { file: "minutes.docx", text: "The new committee takes over in November." }),
    );
    res.links.push({ a: "a", b: "e", verdict: "same", method: "model" }, { a: "a", b: "b", verdict: "same", method: "model" });
    const card = scoreRun(res, s);
    expect(card.commitments).toMatchObject({ found: 3, statusOk: 2 });
    expect(card.extras).toMatchObject({ decoys: 1, restatements: 1, unplanned: 0 });
    expect(card.precision).toBeCloseTo(4 / 5);
    expect(card.links.wrong).toBe(1); // P6 and P7 are different promises
  });

  it("a quote from the same minutes entry but about another item does not find a duty", () => {
    const res = empty();
    const e = ev({ file: "minutes.docx", text: "The equipment log goes to the department office every month, signed by the HoD." });
    res.duties.push({
      id: "d1", level: "committee", trust: "sourced", context: [], schedule: { nextDue: null, startBy: null, basis: null },
      duty: { description: "Equipment log", period: "month", cadence: "every month", approval: null, approver: "HoD", leadTime: null, whenWords: null, owedBy: null, quotes: [{ event: e, quote: "The equipment log goes to the department office every month, signed by the HoD.", relation: "supports" }] },
    });
    const card = scoreRun(res, s);
    expect(card.duties.rows.find((r) => r.id === "Q1")).toMatchObject({ found: true, approverOk: true });
    // Q3's minutes quote is in the same message, but this duty does not quote it.
    expect(card.duties.rows.find((r) => r.id === "Q3")).toMatchObject({ found: false });
  });

  it("finds a leak: finance or private text on a more open item or note", () => {
    const res = empty();
    const open = commitment("x", s.truth.commitments.find((c) => c.id === "P6")!.quote);
    open.candidate.deliverable = "Hand over the camera and the ₹2,200 balance";
    const committeeNote = ev({ file: "whatsapp-committee.txt", text: "The exhibition posters are up near the library." });
    open.context.push({ event: committeeNote, quote: "The exhibition posters are up near the library.", kind: "decision", note: "Joel's scholarship appeal" });
    res.commitments.push(open);
    const leaks = findLeaks(res, s.truth);
    expect(leaks.map((l) => [l.field, l.restricted.text])).toEqual([["deliverable", "₹2,200"], ["context note", "scholarship"]]);
    // The same text on an item at its own level is not a leak.
    const fin = commitment("y", s.truth.commitments.find((c) => c.id === "P5")!.quote);
    expect(findLeaks({ ...empty(), commitments: [fin] }, s.truth)).toEqual([]);
  });
});

// The offline fake over every scenario. These are floors for the fake (a rule-based stand-in),
// not quality claims: the real model is scored by `pnpm eval:pipeline -- --yes`. The invariants
// (no decoys, no wrong links, no leaks, no mixed levels in prompts that write text) hold for any model.
const FLOORS: Record<string, { found: number; status: number; duties: number; contradictions: number }> = {
  mini: { found: 5, status: 5, duties: 2, contradictions: 1 },
  photo: { found: 9, status: 9, duties: 4, contradictions: 1 },
  year: { found: 19, status: 16, duties: 3, contradictions: 1 },
};

for (const name of Object.keys(FLOORS)) {
  describe(`the offline pipeline on the ${name} scenario`, () => {
    let s: Scenario;
    let card: Scorecard;
    const provider = new FakeProvider(fakeHandlers());

    beforeAll(async () => {
      s = await loadScenario(name);
      const res = await runInMemory(s.events, { provider, cache: new MemoryLlmCache(), env: ENV, today: "2026-11-10" });
      card = scoreRun(res, s);
    });

    it("keeps no decoy, links no two different promises, and leaks nothing", () => {
      expect(card.extras.decoys, formatScorecard(card)).toBe(0);
      expect(card.links.wrong).toBe(0);
      expect(card.leaks).toEqual([]);
    });

    it("meets the fake's floor", () => {
      const f = FLOORS[name];
      expect(card.commitments.found, formatScorecard(card)).toBeGreaterThanOrEqual(f.found);
      expect(card.commitments.statusOk).toBeGreaterThanOrEqual(f.status);
      expect(card.duties.found).toBeGreaterThanOrEqual(f.duties);
      expect(card.contradictions.detected).toBeGreaterThanOrEqual(f.contradictions);
    });

    it("puts every planted item with an expected level at that level", () => {
      for (const r of card.commitments.rows.filter((x) => x.found && x.expectedAccess)) expect([r.id, r.level]).toEqual([r.id, r.expectedAccess]);
    });

    it("never says done without evidence: every 'no evidence' item is reported as such", () => {
      for (const r of card.commitments.rows.filter((x) => x.found && x.expectedStatus === "no_evidence")) expect([r.id, r.status]).toEqual([r.id, "no_evidence"]);
    });

    it("never mixes access levels in a prompt whose answer is stored as text", () => {
      const planted = [...s.truth.commitments.map((c) => c.quote), ...s.truth.recurring.flatMap((r) => r.quotes), ...s.truth.decoys];
      for (const call of provider.calls.filter((c) => c.task === EXTRACT_TASK || c.task === DUTIES_TASK)) {
        const levels = new Set(planted.filter((q) => call.user.includes(q.text)).map((q) => s.truth.files[q.file].accessLevel));
        expect([...levels].length, call.user.slice(0, 200)).toBeLessThanOrEqual(1);
        // Restricted text only reaches a prompt with nothing more open in it.
        for (const r of s.truth.restricted.filter((x) => call.user.includes(x.text))) {
          for (const l of levels) expect(levelRank(l)).toBeGreaterThanOrEqual(levelRank(r.level));
        }
      }
    });
  });
}
