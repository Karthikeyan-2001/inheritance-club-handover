import { describe, expect, it } from "vitest";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  const now = new Date("2026-11-09T10:00:00.000Z");

  it("reports ok with a short commit sha when deployed and the db answers", () => {
    const h = buildHealth({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" }, now, "ok");
    expect(h).toEqual({
      status: "ok",
      service: "inheritance",
      commit: "abcdef1",
      db: "ok",
      time: "2026-11-09T10:00:00.000Z",
    });
  });

  it("reports a null commit locally", () => {
    expect(buildHealth({}, now, "ok").commit).toBeNull();
  });

  it.each(["error", "not_configured"] as const)("is degraded when the db is %s", (db) => {
    expect(buildHealth({}, now, db)).toMatchObject({ status: "degraded", db });
  });
});
