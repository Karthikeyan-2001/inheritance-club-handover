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
  it("links the Review step to its page, and leaves Handover as upcoming", () => {
    expect(STEP_HREF.Review).toBe("/review");
    expect(STEP_HREF.Handover).toBeUndefined();
  });
});
