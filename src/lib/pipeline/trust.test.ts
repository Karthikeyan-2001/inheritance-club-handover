import { describe, expect, it } from "vitest";
import { canBorrow, independent, trustState, type TrustEvidence } from "./trust.ts";

let n = 0;
const ev = (over: Partial<TrustEvidence> = {}): TrustEvidence => ({
  relation: "supports", inferred: false, verified: true, eventId: `e${++n}`, sourceId: "chat", author: "Arun", ...over,
});

describe("trustState", () => {
  it("is a gap when no verified evidence is kept", () => {
    expect(trustState([])).toBe("gap");
    expect(trustState([ev({ verified: false }), ev({ verified: false, sourceId: "trello", author: "Priya" })])).toBe("gap");
  });

  it("is contradicted when one record says done and another says not done", () => {
    expect(trustState([ev(), ev({ relation: "fulfils", sourceId: "trello" }), ev({ relation: "contradicts", author: "Priya" })])).toBe("contradicted");
    // an inferred "done" still conflicts with a stated "not done"
    expect(trustState([ev(), ev({ relation: "fulfils", inferred: true }), ev({ relation: "contradicts" })])).toBe("contradicted");
  });

  it("ignores unverified evidence when looking for a conflict", () => {
    expect(trustState([ev(), ev({ relation: "fulfils", sourceId: "trello" }), ev({ relation: "contradicts", verified: false })])).toBe("corroborated");
  });

  it("is inferred when the only sign of completion is an inference", () => {
    expect(trustState([ev(), ev({ relation: "fulfils", inferred: true, sourceId: "trello", author: "Priya" })])).toBe("inferred");
  });

  it("a stated completion outweighs an inferred one", () => {
    expect(trustState([ev(), ev({ relation: "fulfils", inferred: true }), ev({ relation: "fulfils", author: "Priya" })])).toBe("corroborated");
  });

  it("is corroborated by two records from different files", () => {
    expect(trustState([ev({ author: "Kavya" }), ev({ relation: "fulfils", sourceId: "trello", author: "Kavya" })])).toBe("corroborated");
  });

  it("is corroborated by two different people in the same file", () => {
    expect(trustState([ev(), ev({ relation: "contradicts", author: "Priya" })])).toBe("corroborated");
    expect(trustState([ev({ author: "Priya" }), ev({ relation: "past_instance", author: "Arun" })])).toBe("corroborated");
  });

  it("stays sourced when one person repeats themselves in one file", () => {
    expect(trustState([ev({ author: "Rohan" }), ev({ relation: "fulfils", author: " rohan " })])).toBe("sourced");
  });

  it("stays sourced with a single record, or two quotes from one message", () => {
    expect(trustState([ev()])).toBe("sourced");
    expect(trustState([ev({ eventId: "same" }), ev({ eventId: "same", relation: "past_instance", author: "Priya" })])).toBe("sourced");
  });

  it("never counts an unknown author as a second person", () => {
    expect(trustState([ev({ author: null }), ev({ author: "Arun" })])).toBe("sourced");
    expect(trustState([ev({ author: "" }), ev({ author: null })])).toBe("sourced");
  });

  it("does not let an inferred quote corroborate", () => {
    expect(trustState([ev(), ev({ relation: "fulfils", author: "Arun" }), ev({ relation: "fulfils", inferred: true, sourceId: "trello", author: "Priya" })])).toBe("sourced");
  });
});

describe("independent", () => {
  it("needs different messages, and a different file or a different named person", () => {
    const a = { eventId: "1", sourceId: "chat", author: "Arun" };
    expect(independent(a, { ...a })).toBe(false);
    expect(independent(a, { ...a, eventId: "2" })).toBe(false);
    expect(independent(a, { ...a, eventId: "2", sourceId: "trello" })).toBe(true);
    expect(independent(a, { ...a, eventId: "2", author: "Priya" })).toBe(true);
    expect(independent(a, { ...a, eventId: "2", author: "ARUN" })).toBe(false);
  });
});

describe("canBorrow", () => {
  const v = (level: "everyone" | "committee" | "finance" | "private", privateUploaders: string[] = []) => ({ level, privateUploaders });

  it("borrows from the same or a less restricted level", () => {
    expect(canBorrow(v("finance"), v("committee"))).toBe(true);
    expect(canBorrow(v("committee"), v("committee"))).toBe(true);
    expect(canBorrow(v("private", ["u1"]), v("everyone"))).toBe(true);
  });

  it("never borrows from a more restricted level", () => {
    expect(canBorrow(v("committee"), v("finance"))).toBe(false);
    expect(canBorrow(v("finance"), v("private", ["u1"]))).toBe(false);
  });

  it("between private items, only from files of the same uploaders", () => {
    expect(canBorrow(v("private", ["u1"]), v("private", ["u1"]))).toBe(true);
    expect(canBorrow(v("private", ["u1", "u2"]), v("private", ["u2"]))).toBe(true);
    expect(canBorrow(v("private", ["u1"]), v("private", ["u2"]))).toBe(false);
    expect(canBorrow(v("private", ["u1"]), v("private", ["u1", "u2"]))).toBe(false);
    expect(canBorrow(v("private", ["u1"]), v("private", []))).toBe(false);
  });
});
