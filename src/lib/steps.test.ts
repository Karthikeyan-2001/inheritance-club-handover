import { describe, expect, it } from "vitest";
import { STEP_HREF, stepForPath } from "./steps";

describe("stepForPath", () => {
  it.each([
    ["/import", "Connect"],
    ["/ledger", "Reconstruct"],
    ["/ledger?tab=timeline", "Reconstruct"],
    ["/review", "Review"],
    ["/handover", "Handover"],
    ["/", null],
    ["/login", null],
  ])("%s → %s", (path, step) => {
    expect(stepForPath(path)).toBe(step);
  });
});

describe("STEP_HREF", () => {
  it("links the Review and Handover steps to their pages", () => {
    expect(STEP_HREF.Review).toBe("/review");
    expect(STEP_HREF.Handover).toBe("/handover");
  });
});

describe("Verify", () => {
  it("has a page for every step; Verify opens the Docket", () => {
    expect(Object.keys(STEP_HREF)).toEqual(["Connect", "Reconstruct", "Verify", "Review", "Handover"]);
    expect(STEP_HREF.Verify).toBe("/ledger?tab=docket");
  });

  it("marks the Docket, the Gaps tab and source messages as Verify", () => {
    expect(stepForPath("/ledger", "docket")).toBe("Verify");
    expect(stepForPath("/ledger", "gaps")).toBe("Verify");
    expect(stepForPath("/ledger/evidence/abc")).toBe("Verify");
    expect(stepForPath("/ledger", "recurring")).toBe("Reconstruct");
    expect(stepForPath("/ledger", null)).toBe("Reconstruct");
  });
});
