import { describe, expect, it } from "vitest";
import { pipelineReads } from "./run-pipeline";

describe("pipelineReads", () => {
  it("reads the club's records and skips the outgoing lead's answers to gap questions", () => {
    for (const type of ["whatsapp", "trello", "minutes"]) expect(pipelineReads({ sources: { type } }), type).toBe(true);
    expect(pipelineReads({ sources: { type: "statement" } })).toBe(false);
    // A message whose file the reader cannot see is still read (as before): RLS decided it is readable.
    expect(pipelineReads({ sources: null })).toBe(true);
  });
});
