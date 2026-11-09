import { describe, expect, it } from "vitest";
import { findGaps, groupLinked, type GapInput } from "./ledger-view";

describe("groupLinked", () => {
  const order = ["a", "b", "c", "d"];
  it("folds a same-linked record into the earliest item's card", () => {
    expect(groupLinked(order, [{ a: "b", b: "a", verdict: "same" }])).toEqual([
      { primary: "a", also: ["b"], possible: [] },
      { primary: "c", also: [], possible: [] },
      { primary: "d", also: [], possible: [] },
    ]);
  });
  it("does not chain: A-B and B-C make A with B, and C alone", () => {
    const g = groupLinked(order, [
      { a: "a", b: "b", verdict: "same" },
      { a: "b", b: "c", verdict: "same" },
    ]);
    expect(g.map((x) => [x.primary, x.also])).toEqual([["a", ["b"]], ["c", []], ["d", []]]);
  });
  it("keeps possible matches as a note, not a merge", () => {
    const g = groupLinked(order, [{ a: "a", b: "c", verdict: "possible" }]);
    expect(g[0]).toEqual({ primary: "a", also: [], possible: ["c"] });
    expect(g.map((x) => x.primary)).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores links to items the viewer cannot read", () => {
    expect(groupLinked(["a", "b"], [{ a: "a", b: "hidden", verdict: "same" }])).toEqual([
      { primary: "a", also: [], possible: [] },
      { primary: "b", also: [], possible: [] },
    ]);
  });
  it("handles no items", () => {
    expect(groupLinked([], [])).toEqual([]);
  });
});

describe("findGaps", () => {
  const base: GapInput = { id: "1", kind: "commitment", description: "x", status: "fulfilled", trust_state: "sourced", next_due: null, fulfilment_checked_at: "2026-03-01" };
  it("reports nothing for a well-evidenced commitment", () => {
    expect(findGaps([base])).toEqual([]);
  });
  it("flags a commitment with no evidence kept after the promise", () => {
    const g = findGaps([{ ...base, status: "no_evidence" }]);
    expect(g).toHaveLength(1);
    expect(g[0].what).toContain("No evidence kept");
  });
  it("flags trust gap and unchecked items, and does not flag an open item that was checked", () => {
    expect(findGaps([{ ...base, trust_state: "gap" }])).toHaveLength(1);
    expect(findGaps([{ ...base, status: "open", fulfilment_checked_at: null }])[0].what).toBe("Not yet checked for follow-up.");
    expect(findGaps([{ ...base, status: "open" }])).toEqual([]);
  });
  it("flags a duty with no derivable next date, not one that has it", () => {
    const duty = { ...base, kind: "recurring" as const, status: "open" as const, fulfilment_checked_at: null };
    expect(findGaps([duty])[0].what).toContain("next date");
    expect(findGaps([{ ...duty, next_due: "2027-01-01" }])).toEqual([]);
  });
});
