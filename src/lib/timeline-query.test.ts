import { describe, expect, it } from "vitest";
import { likePattern, parseTimelineParams, timelineHref } from "./timeline-query";

describe("parseTimelineParams", () => {
  it("accepts valid values", () => {
    const id = "d0000002-0000-4000-8000-000000000001";
    expect(parseTimelineParams({ source: id, q: " lab ", page: "3" })).toEqual({ source: id, q: "lab", page: 3 });
  });
  it("falls back on junk", () => {
    expect(parseTimelineParams({ source: "x'; drop", page: "-2" })).toEqual({ source: null, q: "", page: 1 });
    expect(parseTimelineParams({ q: "a".repeat(300) }).q).toHaveLength(100);
  });
});

describe("likePattern", () => {
  it("escapes wildcards", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});

describe("timelineHref", () => {
  it("keeps filters and drops defaults", () => {
    expect(timelineHref({ source: null, q: "lab", page: 1 }, { page: 2 })).toBe("/ledger?tab=timeline&q=lab&page=2");
    expect(timelineHref({ source: null, q: "", page: 4 }, { page: 1 })).toBe("/ledger?tab=timeline");
  });
});
