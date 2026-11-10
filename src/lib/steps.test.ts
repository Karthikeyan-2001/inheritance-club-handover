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
