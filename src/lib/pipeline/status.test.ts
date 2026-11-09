import { describe, expect, it } from "vitest";
import { followupStatus, type StatusEvidence } from "./status";

const ev = (relation: StatusEvidence["relation"], over: Partial<StatusEvidence> = {}): StatusEvidence => ({ relation, inferred: false, verified: true, ...over });
const promise = ev("supports");

describe("followupStatus", () => {
  it("no follow-up at all is 'no evidence kept', never pending or done", () => {
    expect(followupStatus([])).toBe("no_evidence");
    expect(followupStatus([promise])).toBe("no_evidence");
  });

  it("a plain report of completion is fulfilled", () => {
    expect(followupStatus([promise, ev("fulfils")])).toBe("fulfilled");
  });

  it("evidence that only implies completion is likely fulfilled, not fulfilled", () => {
    expect(followupStatus([promise, ev("fulfils", { inferred: true })])).toBe("likely_fulfilled");
    expect(followupStatus([promise, ev("fulfils", { inferred: true }), ev("fulfils")])).toBe("fulfilled");
  });

  it("done and not done together is contradicted, whichever is direct", () => {
    expect(followupStatus([promise, ev("fulfils"), ev("contradicts")])).toBe("contradicted");
    expect(followupStatus([promise, ev("fulfils", { inferred: true }), ev("contradicts")])).toBe("contradicted");
  });

  it("only 'not done' leaves it open (still owed)", () => {
    expect(followupStatus([promise, ev("contradicts")])).toBe("open");
  });

  it("ignores unverified evidence", () => {
    expect(followupStatus([promise, ev("fulfils", { verified: false })])).toBe("no_evidence");
    expect(followupStatus([promise, ev("fulfils"), ev("contradicts", { verified: false })])).toBe("fulfilled");
  });
});
