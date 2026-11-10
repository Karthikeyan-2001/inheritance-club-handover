import { describe, expect, it } from "vitest";
import { diffVersions, isEmptyDiff, type DiffRow, type VersionItem } from "./diff.ts";

const ev = (quote: string, relation = "supports", extra = {}) => ({ event_id: `e-${quote}`, quote, relation, verified: true, ...extra });
const item = (over: Record<string, unknown> = {}, extra: Partial<VersionItem> = {}): VersionItem => ({
  format: 2,
  obligation: { description: "Send certificates", owed_by: "Arun", status: "open", trust_state: "sourced", ...over },
  evidence: [ev("we will send them")],
  linked_same: [],
  conflicts: [],
  ...extra,
});
const row = (id: string, i: VersionItem, notes?: DiffRow["notes"]): DiffRow => ({ obligation_id: id, item: i, notes });

describe("diffVersions", () => {
  it("treats every item as new when there is no earlier version", () => {
    const d = diffVersions(null, [row("a", item()), row("b", item({ description: "Return sensors" }))]);
    expect(d.added.map((a) => a.description)).toEqual(["Send certificates", "Return sensors"]);
    expect(d.changed).toEqual([]);
  });

  it("reports added, removed, changed and unchanged items", () => {
    const prev = [row("a", item()), row("b", item({ description: "B" })), row("c", item({ description: "C" }))];
    const next = [row("a", item({ due_text: "by 20 March" })), row("c", item({ description: "C" })), row("d", item({ description: "D" }))];
    const d = diffVersions(prev, next);
    expect(d.added).toEqual([{ id: "d", description: "D" }]);
    expect(d.removed).toEqual([{ id: "b", description: "B" }]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].fields).toEqual([{ field: "due_text", label: "Due (as written)", before: null, after: "by 20 March" }]);
    expect(d.unchanged).toBe(1);
  });

  it("shows before and after for status and trust, and quotes added and removed", () => {
    const prev = [row("a", item())];
    const next = [row("a", item({ status: "fulfilled", trust_state: "corroborated" }, { evidence: [ev("it is done", "fulfils")] }))];
    const [c] = diffVersions(prev, next).changed;
    expect(c.fields.map((f) => [f.label, f.before, f.after])).toEqual([["Status", "open", "fulfilled"], ["Trust", "sourced", "corroborated"]]);
    expect(c.quotesAdded).toEqual([{ quote: "it is done", relation: "fulfils" }]);
    expect(c.quotesRemoved).toEqual([{ quote: "we will send them", relation: "supports" }]);
  });

  it("treats blank and missing values as the same", () => {
    const d = diffVersions([row("a", item({ owed_to: "" }))], [row("a", item({ owed_to: null }))]);
    expect(isEmptyDiff(d)).toBe(true);
  });

  it("reports links, rulings and notes between two format-2 items", () => {
    const prev = [row("a", item({}, { linked_same: ["x"], conflicts: [{ id: "d1", summary: "Trello v chat", ruling: null, reason: null }] }), [{ id: "n1", kind: "contact", text: "Accounts" }])];
    const next = [row("a", item({}, { linked_same: ["y"], conflicts: [{ id: "d1", summary: "Trello v chat", ruling: "not_done", reason: "Later message" }] }), [{ id: "n2", kind: "risk", text: "Slow" }])];
    const [c] = diffVersions(prev, next).changed;
    expect(c.linksAdded).toEqual(["y"]);
    expect(c.linksRemoved).toEqual(["x"]);
    expect(c.rulings).toEqual([{ summary: "Trello v chat", before: null, after: "not_done" }]);
    expect(c.notesAdded.map((n) => n.id)).toEqual(["n2"]);
    expect(c.notesRemoved.map((n) => n.id)).toEqual(["n1"]);
  });

  it("compares an older (format 1) item only on the fields it recorded", () => {
    const old: VersionItem = { obligation: { description: "Send certificates", owed_by: "Arun", status: "open", trust_state: "sourced" }, evidence: [ev("we will send them")] };
    const current = item({ cadence: null, period: null, review_state: "accepted" }, { linked_same: ["z"], conflicts: [{ id: "d", ruling: "done", reason: "x" }] });
    expect(isEmptyDiff(diffVersions([row("a", old)], [row("a", current)]))).toBe(true);
    const edited = diffVersions([row("a", old)], [row("a", item({ owed_by: "Priya" }))]);
    expect(edited.changed[0].fields).toEqual([{ field: "owed_by", label: "Owed by", before: "Arun", after: "Priya" }]);
  });

  it("does not report notes when one side has none recorded", () => {
    const d = diffVersions([row("a", item())], [row("a", item(), [{ id: "n", kind: "risk", text: "t" }])]);
    expect(isEmptyDiff(d)).toBe(true);
  });
});
