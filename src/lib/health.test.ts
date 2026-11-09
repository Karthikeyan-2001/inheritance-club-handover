import { describe, expect, it } from "vitest";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  const now = new Date("2026-11-09T10:00:00.000Z");

  it("reports ok with a short commit sha when deployed", () => {
    const h = buildHealth({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" }, now);
    expect(h).toEqual({
      status: "ok",
      service: "inheritance",
      commit: "abcdef1",
      time: "2026-11-09T10:00:00.000Z",
    });
  });

  it("reports a null commit locally", () => {
    expect(buildHealth({}, now).commit).toBeNull();
  });
});
