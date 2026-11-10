import { describe, expect, it } from "vitest";
import { changedFields, editableFields, validDate } from "./fields.ts";
import { readiness } from "./readiness.ts";
import { needsRereview, rereviewChange } from "./rereview.ts";

describe("changedFields", () => {
  const current = { description: "Send certificates", owed_by: "Arun", owed_to: null, due_text: "by 15 March", due_date: "2026-03-15" };

  it("keeps only the editable fields that differ, trimmed", () => {
    const { changes, error } = changedFields("commitment", current, { description: "  Send certificates ", owed_by: "Priya ", due_text: "by 15 March", status: "fulfilled" });
    expect(error).toBeUndefined();
    expect(changes).toEqual({ owed_by: "Priya" });
  });

  it("clears a field with a blank, and leaves fields that were not submitted", () => {
    expect(changedFields("commitment", current, { due_text: "" }).changes).toEqual({ due_text: "" });
    expect(changedFields("commitment", current, {}).changes).toEqual({});
  });

  it("refuses an empty description and an invalid date", () => {
    expect(changedFields("commitment", current, { description: "  " }).error).toMatch(/cannot be empty/);
    expect(changedFields("commitment", current, { due_date: "20/03/2026" }).error).toMatch(/YYYY-MM-DD/);
    expect(changedFields("commitment", current, { due_date: "2026-02-30" }).error).toMatch(/YYYY-MM-DD/);
  });

  it("has different editable fields per kind, and never status or trust", () => {
    expect(editableFields("commitment")).not.toContain("cadence");
    expect(editableFields("recurring")).toContain("approver");
    for (const k of ["commitment", "recurring"] as const) expect(editableFields(k)).not.toEqual(expect.arrayContaining(["status"]));
    expect(changedFields("recurring", {}, { owed_to: "x" }).changes).toEqual({});
  });

  it("validates calendar dates", () => {
    expect(validDate("2026-03-15")).toBe(true);
    expect(validDate("")).toBe(true);
    expect(validDate("2026-13-01")).toBe(false);
  });
});

describe("needsRereview", () => {
  const base = { review_state: "accepted", status: "open", trust_state: "sourced", reviewed_status: "open", reviewed_trust: "sourced" };
  it("is false while status and trust are what they were accepted with", () => {
    expect(needsRereview(base)).toBe(false);
    expect(rereviewChange(base)).toEqual({ status: null, trust: null });
  });
  it("is true when either moved, and says which", () => {
    expect(needsRereview({ ...base, trust_state: "contradicted" })).toBe(true);
    expect(rereviewChange({ ...base, status: "fulfilled", trust_state: "corroborated" })).toEqual({
      status: { was: "open", now: "fulfilled" },
      trust: { was: "sourced", now: "corroborated" },
    });
  });
  it("only applies to accepted and edited items", () => {
    expect(needsRereview({ ...base, review_state: "draft", trust_state: "gap" })).toBe(false);
    expect(needsRereview({ ...base, review_state: "rejected", trust_state: "gap" })).toBe(false);
    expect(needsRereview({ ...base, review_state: "edited", trust_state: "gap" })).toBe(true);
  });
  it("treats an accepted item with no recorded baseline as changed", () => {
    expect(needsRereview({ ...base, reviewed_status: null, reviewed_trust: null })).toBe(true);
  });
});

describe("readiness", () => {
  const ok = { acceptedCount: 4, needsRereviewCount: 0, signoff: { isCurrent: true } };

  it("lets the outgoing lead mark ready and the advisor approve a current mark", () => {
    expect(readiness({ ...ok, role: "outgoing_lead" }).markReady).toEqual({ ok: true, reasons: [] });
    expect(readiness({ ...ok, role: "advisor" }).approve).toEqual({ ok: true, reasons: [] });
  });

  it("names who may act", () => {
    expect(readiness({ ...ok, role: "advisor" }).markReady.reasons[0]).toMatch(/Only the outgoing lead/);
    expect(readiness({ ...ok, role: "outgoing_lead" }).approve.reasons[0]).toMatch(/Only the faculty advisor/);
  });

  it("blocks both until accepted items changed since acceptance are reviewed again", () => {
    const r = readiness({ ...ok, role: "advisor", needsRereviewCount: 2 });
    expect(r.approve.ok).toBe(false);
    expect(r.approve.reasons.join(" ")).toMatch(/2 accepted items have changed/);
    expect(readiness({ ...ok, role: "outgoing_lead", needsRereviewCount: 1 }).markReady.reasons[0]).toMatch(/1 accepted item has changed/);
  });

  it("blocks approval without a mark, or with one that no longer matches", () => {
    expect(readiness({ ...ok, role: "advisor", signoff: null }).approve.reasons).toEqual(["The outgoing lead has not marked the draft ready for the advisor."]);
    expect(readiness({ ...ok, role: "advisor", signoff: { isCurrent: false } }).approve.reasons[0]).toMatch(/must be marked ready again/);
  });

  it("blocks both when nothing is accepted", () => {
    const r = readiness({ ...ok, role: "advisor", acceptedCount: 0 });
    expect(r.markReady.reasons).toContain("No item is accepted yet.");
    expect(r.approve.reasons).toContain("No item is accepted yet.");
  });
});
