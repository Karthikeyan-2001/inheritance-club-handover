import { beforeAll, describe, expect, it } from "vitest";
import { eventFor, miniEvents, miniTruth, type MiniEvent } from "../../../scripts/mini-scenario";
import { MemoryLlmCache } from "../llm/cache-memory";
import { FakeProvider } from "../llm/provider-fake";
import { fakeHandlers } from "./provider";
import { runInMemory, type MemoryResult } from "./run-memory";
import { normaliseForQuote } from "./verify";

const ENV = { LLM_MODEL_FAST: "fake-fast", LLM_MODEL_STRONG: "fake-strong" };

describe("the whole pipeline on the mini scenario (fake model)", () => {
  const truth = miniTruth();
  let events: MiniEvent[];
  let res: MemoryResult;
  const provider = new FakeProvider(fakeHandlers());
  const cache = new MemoryLlmCache();

  beforeAll(async () => {
    events = await miniEvents();
    res = await runInMemory(events, { provider, cache, env: ENV, today: "2026-11-09" });
  });

  const commitment = (id: string) => {
    const e = eventFor(events, truth.commitments.find((c) => c.id === id)!.quote);
    return res.commitments.find((c) => c.candidate.event.id === e?.id);
  };

  it("finds every commitment and gives each the expected status", () => {
    for (const c of truth.commitments) expect([c.id, commitment(c.id)?.status]).toEqual([c.id, c.expectedStatus]);
  });

  it("finds the follow-up evidence the ground truth lists, including both sides of contradiction X1", () => {
    for (const c of truth.commitments) {
      const found = commitment(c.id)!;
      for (const e of c.evidence) {
        const hit = found.evidence.some((k) => k.relation === e.relation && eventFor(events, e)?.id === k.event.id);
        expect([c.id, e.text, hit]).toEqual([c.id, e.text, true]);
      }
    }
    const x1 = commitment("C1")!;
    expect(x1.evidence.some((e) => e.relation === "fulfils")).toBe(true);
    expect(x1.evidence.some((e) => e.relation === "contradicts")).toBe(true);
  });

  it("finds recurring duties R1 and R2 with their approvers, at the committee level", () => {
    for (const r of truth.recurring) {
      const ids = new Set(r.quotes.map((q) => eventFor(events, q)?.id));
      const duty = res.duties.find((d) => d.duty.quotes.some((q) => ids.has(q.event.id)) && d.duty.quotes.every((q) => q.event.accessLevel === "committee"));
      expect(duty, r.id).toBeDefined();
      expect(normaliseForQuote(r.approver)).toContain(normaliseForQuote(duty!.duty.approver ?? "-"));
    }
  });

  it("gives each commitment and committee-level duty the expected trust", () => {
    for (const c of truth.commitments) expect([c.id, commitment(c.id)?.trust]).toEqual([c.id, c.expectedTrust]);
    for (const r of truth.recurring) {
      const ids = new Set(r.quotes.map((q) => eventFor(events, q)?.id));
      const duty = res.duties.find((d) => d.level === "committee" && d.duty.quotes.some((q) => ids.has(q.event.id)));
      expect([r.id, duty?.trust]).toEqual([r.id, r.expectedTrust]);
    }
  });

  it("links each Trello card to the chat promise it restates, and never two different promises", () => {
    const card = (name: string) => res.commitments.find((c) => c.candidate.quote === `Card: ${name}`);
    const same = (a?: { id: string }, b?: { id: string }) =>
      res.links.some((l) => l.verdict === "same" && a && b && [l.a, l.b].sort().join() === [a.id, b.id].sort().join());
    expect(same(commitment("C1"), card("Send certificates to workshop speakers"))).toBe(true);
    expect(same(commitment("C4"), card("Print fest posters"))).toBe(true);
    const truthIds = new Set(truth.commitments.map((c) => commitment(c.id)?.id));
    for (const l of res.links) expect(truthIds.has(l.a) && truthIds.has(l.b), `${l.a}-${l.b}`).toBe(false);
    // The card borrows the chat's evidence, so it is contradicted too.
    expect(card("Send certificates to workshop speakers")?.trust).toBe("contradicted");
  });

  it("keeps the decoys out", () => {
    const decoys = new Set(truth.decoys.map((d) => eventFor(events, d)?.id));
    expect(res.commitments.some((c) => decoys.has(c.candidate.event.id))).toBe(false);
  });

  it("is cached: a second run makes no new model calls", async () => {
    const before = provider.calls.length;
    await runInMemory(events, { provider, cache, env: ENV, today: "2026-11-09" });
    expect(provider.calls.length).toBe(before);
  });

  it("never mixes access levels in one prompt", () => {
    const finance = events.filter((e) => e.accessLevel === "finance").map((e) => e.text.split("\n")[0]);
    const committee = events.filter((e) => e.accessLevel === "committee").map((e) => e.text.split("\n")[0]);
    // Follow-up checks read related messages the requester may read; match prompts show two items
    // side by side and get back only a verdict. Neither stores model-written text at a lower level.
    for (const call of provider.calls.filter((c) => !["check_followup", "duty_context", "match_items"].includes(c.task))) {
      const hasFinance = finance.some((t) => call.user.includes(t));
      const hasCommittee = committee.some((t) => call.user.includes(t));
      expect(hasFinance && hasCommittee).toBe(false);
    }
  });
});
