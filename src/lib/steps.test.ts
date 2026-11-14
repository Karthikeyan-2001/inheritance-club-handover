import { describe, expect, it } from "vitest";
import { STEP_HREF, stepForPath } from "./steps";

describe("stepForPath", () => {
  it.each([
    ["/import", "Connect"],
    ["/ledger", "Reconstruct"],
    ["/check", "Verify"],
    ["/messages", null],
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
  it("has a page for every step; Verify opens the check page", () => {
    expect(Object.keys(STEP_HREF)).toEqual(["Connect", "Reconstruct", "Verify", "Review", "Handover"]);
    expect(STEP_HREF.Verify).toBe("/check");
  });

  it("marks the check page and source messages as Verify", () => {
    expect(stepForPath("/check")).toBe("Verify");
    expect(stepForPath("/ledger/evidence/abc")).toBe("Verify");
  });

  it("gives every step its own page, so no two steps share a path", () => {
    const paths = Object.values(STEP_HREF).map((h) => h!.split("?")[0]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const [step, href] of Object.entries(STEP_HREF)) expect(stepForPath(href!.split("?")[0])).toBe(step);
  });
});

describe("STEP_LABEL", () => {
  it("names every step in plain words, and no two alike", async () => {
    const { STEP_LABEL, STEPS } = await import("./steps");
    const labels = STEPS.map((s) => STEP_LABEL[s]);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(STEPS.length);
  });
});
