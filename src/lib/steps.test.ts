import { describe, expect, it } from "vitest";
import { stepForPath } from "./steps";

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
