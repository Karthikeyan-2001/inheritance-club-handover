import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/ledger?tab=docket")).toBe("/ledger?tab=docket");
  });
  it.each([null, 42, "", "https://evil.example", "//evil.example", "/\\evil.example", "/login"])(
    "falls back for %s",
    (v) => {
      expect(safeNextPath(v)).toBe("/");
    },
  );
});
