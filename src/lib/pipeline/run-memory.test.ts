import { beforeAll, describe, expect, it } from "vitest";
import { eventFor, miniEvents, miniTruth, type MiniEvent } from "../../../scripts/mini-scenario";
import { MemoryLlmCache } from "../llm/cache-memory";
import { FakeProvider } from "../llm/provider-fake";
import { fakeHandlers } from "./provider";
import { runInMemory, trigramSimilarity, type MemoryResult } from "./run-memory";
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
    for (const call of provider.calls.filter((c) => c.task !== "check_followup" && c.task !== "duty_context")) {
      const hasFinance = finance.some((t) => call.user.includes(t));
      const hasCommittee = committee.some((t) => call.user.includes(t));
      expect(hasFinance && hasCommittee).toBe(false);
    }
  });
});

describe("trigramSimilarity", () => {
  it("is close to pg_trgm for paraphrased duty names", () => {
    expect(trigramSimilarity("Get HoD permission letter before lab booking", "Get the HoD's permission letter before booking the lab")).toBeGreaterThan(0.55);
    expect(trigramSimilarity("Book the auditorium", "Return ESP32 boards")).toBeLessThan(0.2);
    expect(trigramSimilarity("", "")).toBe(0);
  });
});
