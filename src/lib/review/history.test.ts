import { describe, expect, it } from "vitest";
import { actionLabel, describeChanges } from "./history.ts";
import { rulingLabel } from "./labels.ts";

describe("review history", () => {
  it("names each review action in plain words", () => {
    expect(actionLabel("accept")).toBe("Accepted");
    expect(actionLabel("link_distinct")).toBe("Marked two records as not the same");
    expect(actionLabel("something_else")).toBe("something_else");
  });

  it("lists only the editable fields an edit changed", () => {
    const changes = describeChanges({
      action: "edit",
      before: { description: "Send certificates", due_text: null, owed_by: "Arun", status: "open" },
      after: { description: "Send certificates", due_text: "by 20 March", owed_by: "Arun", status: "open", review_state: "edited" },
    });
    expect(changes).toEqual([{ label: "Due (as written)", before: "nothing", after: "by 20 March" }]);
  });

  it("describes rulings, review moves, links, marks and approvals", () => {
    expect(describeChanges({ action: "rule", before: { ruling: null }, after: { ruling: "not_done" } })).toEqual([{ label: "Ruling", before: "No ruling yet", after: "Not done" }]);
    expect(describeChanges({ action: "reject", before: { review_state: "accepted" }, after: { review_state: "rejected" } })).toEqual([{ label: "Review", before: "accepted", after: "rejected" }]);
    expect(describeChanges({ action: "link_same", before: null, after: { verdict: "same" } })).toEqual([{ label: "Link", before: "nothing", after: "same" }]);
    expect(describeChanges({ action: "mark_ready", before: null, after: { item_count: 4 } })[0].after).toBe("4");
    expect(describeChanges({ action: "approve_version", before: null, after: { number: 2 } })[0].after).toBe("number 2");
    expect(describeChanges({ action: "release", before: null, after: { to_role: "incoming_lead" } })).toEqual([]);
  });

  it("describes a gap answer by what it changed on the item", () => {
    expect(actionLabel("answer_gap")).toBe("Answered a gap question");
    const changes = describeChanges({
      action: "answer_gap",
      before: { status: "no_evidence", trust_state: "sourced", approver: null, access_level: "everyone" },
      after: { status: "fulfilled", trust_state: "corroborated", approver: null, access_level: "everyone", question: "followup", answer: "done" },
    });
    expect(changes).toEqual([
      { label: "Status", before: "no_evidence", after: "fulfilled" },
      { label: "Trust", before: "sourced", after: "corroborated" },
    ]);
  });

  it("labels rulings", () => {
    expect(rulingLabel("cannot_tell")).toBe("Cannot tell");
    expect(rulingLabel(null)).toBe("No ruling yet");
  });
});
