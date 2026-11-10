import { describe, expect, it } from "vitest";
import { FakeProvider } from "../llm/provider-fake.ts";
import { fakeMatch } from "./fake-pipeline.ts";
import { MAX_ASK, batchPairs, buildMatchPrompt, decide, pairKey, partyTokens, planMatches, postProcessMatches, scorePair, type MatchItem } from "./match.ts";

const item = (id: string, over: Partial<MatchItem> = {}): MatchItem => ({
  id, kind: "commitment", description: "Send certificates to workshop speakers", owedBy: "Arun", owedTo: "Workshop speakers",
  dueText: null, cadence: null, approver: null, level: "committee",
  sources: [{ eventId: `ev-${id}`, quote: "Card: Send certificates to workshop speakers", ts: "2026-03-02T14:30:00+05:30", sourceType: "trello" }],
  ...over,
});

const chatPromise = item("chat", {
  description: "Participation certificates for workshop speakers",
  sources: [{ eventId: "c1", quote: "we will send the participation certificates to all workshop speakers by 15 March", ts: "2026-03-02T19:42:00+05:30", sourceType: "whatsapp" }],
});
const aliases = [{ canonical: "Mr. Bala", variants: ["Bala sir", "lab incharge", "Bala"] }];

describe("partyTokens", () => {
  it("maps aliases to one name and drops honorifics and generic groups", () => {
    expect(partyTokens("Bala sir (lab in-charge)", aliases)).toEqual(partyTokens("Mr. Bala", aliases));
    expect(partyTokens("the club", aliases).size).toBe(0);
    expect(partyTokens(null, aliases).size).toBe(0);
    expect([...partyTokens("Brightwave Labs", [])]).toEqual(["brightwave"]);
  });
});

describe("scorePair and decide", () => {
  it("links near-identical items for the same people by rule", () => {
    const s = scorePair(item("a"), item("b", { description: "Send the certificates to workshop speakers" }), []);
    expect(s.floor).toBeGreaterThanOrEqual(0.7);
    expect(decide(s)).toBe("rule");
  });

  it("never links by rule when a number differs", () => {
    const s = scorePair(item("a", { description: "Return 6 DHT22 sensors" }), item("b", { description: "Return 8 DHT22 sensors" }), []);
    expect(s.numbersDiffer).toBe(true);
    expect(decide(s)).toBe("ask");
  });

  it("asks the model about a paraphrase (the chat promise against its Trello card)", () => {
    const s = scorePair(chatPromise, item("card"), []);
    expect(s).toMatchObject({ sharedParty: true, partyConflict: false, withinWindow: true });
    expect(decide(s)).toBe("ask");
  });

  it("matches people through the alias table", () => {
    const a = item("a", { description: "Return the borrowed ESP32 boards", owedTo: "Bala sir" });
    const b = item("b", { description: "Give back ESP32 boards", owedTo: "Mr. Bala (lab in-charge)" });
    expect(scorePair(a, b, aliases).sharedParty).toBe(true);
    expect(scorePair(a, b, []).partyConflict).toBe(false); // "bala" is shared even without the alias
  });

  it("does not link by rule when the people differ, and leaves weak pairs alone", () => {
    const toOthers = item("b", { owedTo: "Robotics club speakers" });
    const s = scorePair(item("a", { owedTo: "Brightwave Labs" }), toOthers, []);
    expect(s.partyConflict).toBe(true);
    expect(decide(s)).toBe("ask"); // identical wording is still worth a look
    expect(decide({ ...s, score: 0.45 })).toBeNull();
    expect(decide(scorePair(item("a"), item("b", { description: "Book the auditorium for IoT Fest", owedTo: null }), []))).toBeNull();
  });

  it("treats commitments made months apart as different occasions", () => {
    const later = item("b", { sources: [{ eventId: "x", quote: "q", ts: "2026-09-10T10:00:00+05:30", sourceType: "trello" }] });
    expect(decide(scorePair(item("a"), later, []))).toBeNull();
  });

  it("has no time window for recurring duties", () => {
    const duty = (id: string, ts: string, description: string): MatchItem => ({
      ...item(id), kind: "recurring", owedTo: null, approver: "HoD", cadence: "every semester", description,
      sources: [{ eventId: id, quote: description, ts, sourceType: "minutes" }],
    });
    const s = scorePair(duty("a", "2025-08-01T10:00:00+05:30", "Get the HoD's permission letter before booking the lab"), duty("b", "2026-03-01T10:00:00+05:30", "Signed HoD permission letter required before lab booking"), []);
    expect(s).toMatchObject({ withinWindow: true, sharedParty: true });
    expect(decide(s)).not.toBeNull();
  });

  it("a shared source message lowers the bar for asking", () => {
    const base = { score: 0.15, floor: 0.1, numbersDiffer: false, sharedParty: false, partyConflict: false, withinWindow: true };
    expect(decide({ ...base, sharedSource: false })).toBeNull();
    expect(decide({ ...base, sharedSource: true })).toBe("ask");
  });
});

describe("planMatches", () => {
  it("pairs only items of the same kind, deterministically, best first", () => {
    const duty: MatchItem = { ...item("d"), kind: "recurring" };
    const items = [item("z"), chatPromise, item("y", { description: "Send the certificates to workshop speakers" }), duty];
    const one = planMatches(items, []);
    const two = planMatches([...items].reverse(), []);
    expect(one).toEqual(two);
    expect([...one.rule, ...one.ask].every((p) => p.a !== "d" && p.b !== "d")).toBe(true);
    expect(one.rule).toEqual([{ a: "y", b: "z", score: expect.any(Number) }]);
    expect(one.ask.map((p) => [p.a, p.b])).toEqual(expect.arrayContaining([["chat", "y"], ["chat", "z"]]));
    for (let i = 1; i < one.ask.length; i++) expect(one.ask[i - 1].score).toBeGreaterThanOrEqual(one.ask[i].score);
  });

  it("never scores a pair a reviewer has ruled on, whichever way round it is written", () => {
    const items = [item("z"), chatPromise, item("y", { description: "Send the certificates to workshop speakers" })];
    const all = planMatches(items, []);
    expect(all.rule).toHaveLength(1);
    const skipped = planMatches(items, [], MAX_ASK, new Set([pairKey("z", "y"), pairKey("y", "chat")]));
    expect(skipped.rule).toEqual([]);
    expect(skipped.ask.map((p) => pairKey(p.a, p.b))).not.toContain(pairKey("chat", "y"));
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });

  it("caps the pairs sent to the model and counts the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`i${String(i).padStart(2, "0")}`, { description: `Send certificates to workshop speakers batch ${i}` }));
    // Every pair differs only by its batch number: none is linked by rule, all 66 are worth asking.
    const r = planMatches(many, [], 5);
    expect(r.rule).toEqual([]);
    expect(r.ask).toHaveLength(5);
    expect(r.overLimit).toBe(66 - 5);
    expect(planMatches(many, []).ask).toHaveLength(MAX_ASK);
  });
});

describe("the match prompt and its verdicts", () => {
  const items = new Map([chatPromise, item("card")].map((i) => [i.id, i]));
  const pairs = [{ a: "card", b: "chat", score: 0.5 }];

  it("shows both items with their quotes, and nothing else", () => {
    const { user, refs } = buildMatchPrompt(pairs, items);
    expect(refs.get("p1")).toEqual(pairs[0]);
    expect(user).toContain("Pair p1");
    expect(user).toContain('Stated in Chat, 2 Mar 2026, 7:42 pm IST: "we will send the participation certificates');
    expect(user).toContain("A: Commitment: Send certificates to workshop speakers | owed by Arun to Workshop speakers");
  });

  it("keeps one verdict per known pair; unsure is a possible match; missing ones are counted", () => {
    const refs = new Map([["p1", pairs[0]], ["p2", { a: "x", b: "y", score: 0.4 }], ["p3", { a: "u", b: "v", score: 0.3 }]]);
    const r = postProcessMatches({ verdicts: [
      { pair: "p1", verdict: "same" }, { pair: "[P1]", verdict: "different" }, { pair: "p2", verdict: "unsure" }, { pair: "p9", verdict: "same" },
    ] }, refs);
    expect(r.same).toEqual([pairs[0]]);
    expect(r.possible).toEqual([{ a: "x", b: "y", score: 0.4 }]);
    expect(r.dropped).toEqual({ duplicate: 1, unknown_pair: 1, no_verdict: 1 });
  });

  it("the offline fake reads the same prompt", async () => {
    const { user } = buildMatchPrompt([...pairs, { a: "card", b: "other", score: 0.3 }], new Map([...items, ["other", item("other", { description: "Book the auditorium" })]]));
    const out = await new FakeProvider({ match_items: fakeMatch }).complete({ task: "match_items", model: "m", system: "", user, schema: null as never, maxTokens: 1, effort: "low" });
    expect(out.output).toEqual({ verdicts: [{ pair: "p1", verdict: "same" }, { pair: "p2", verdict: "different" }] });
  });

  it("batches in fixed slices", () => {
    expect(batchPairs(Array.from({ length: 10 }, (_, i) => ({ a: `${i}`, b: "z", score: 1 })), 4).map((b) => b.length)).toEqual([4, 4, 2]);
  });
});
