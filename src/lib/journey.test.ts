import { describe, expect, it } from "vitest";
import { awaitingApproval, journey, type JourneyFacts } from "./journey";

const base: JourneyFacts = {
  role: "outgoing_lead",
  files: 0,
  items: 0,
  toReview: 0,
  accepted: 0,
  signoff: null,
  version: null,
  answered: 0,
  unruledConflicts: 0,
  gaps: 0,
  openQuestions: 0,
};
const v1 = { number: 1, createdAt: "2026-11-10T10:00:00Z", itemCount: 4 };
const f = (over: Partial<JourneyFacts>): JourneyFacts => ({ ...base, ...over });

describe("outgoing lead", () => {
  it("starts by adding files", () => {
    const j = journey(f({}));
    expect(j.cta?.href).toBe("/import");
    expect(j.doneCount).toBe(0);
    expect(j.stages[0].state).toBe("current");
  });
  it("builds the ledger once files exist", () => {
    expect(journey(f({ files: 3 })).cta?.href).toBe("/ledger");
  });
  it("after a build, checks the records before reviewing", () => {
    const j = journey(f({ files: 3, items: 9, toReview: 9, unruledConflicts: 1, gaps: 3 }));
    expect(j.cta?.href).toBe("/check");
    expect(j.stages[2].state).toBe("current");
    expect(j.also[0].href).toBe("/review?tab=draft");
  });
  it("reviews items once reviewing has started", () => {
    const j = journey(f({ files: 3, items: 9, toReview: 8, accepted: 1, gaps: 3 }));
    expect(j.title).toBe("Review 8 items");
    expect(j.cta?.href).toBe("/review?tab=draft");
  });
  it("goes straight to review when nothing disagrees or is missing", () => {
    expect(journey(f({ files: 3, items: 9, toReview: 9 })).cta?.href).toBe("/review?tab=draft");
  });
  it("marks ready when nothing is left to check", () => {
    const j = journey(f({ files: 3, items: 9, accepted: 9, signoff: null }));
    expect(j.cta?.label).toBe("Mark ready");
  });
  it("hands the next step to the advisor once marked", () => {
    const j = journey(f({ files: 3, items: 9, accepted: 9, signoff: { isCurrent: true, markedAt: "2026-11-10T09:00:00Z" } }));
    expect(j.cta).toBeNull();
    expect(j.switchTo?.key).toBe("meena");
  });
  it("points at the incoming lead after approval", () => {
    const j = journey(f({ files: 3, items: 9, accepted: 9, version: v1, answered: 1, signoff: { isCurrent: true, markedAt: "2026-11-10T09:00:00Z" } }));
    expect(j.title).toContain("Version 1");
    expect(j.switchTo?.key).toBe("kavya");
    expect(j.doneCount).toBe(4);
  });
});

describe("gap questions (outgoing lead)", () => {
  it("asks the lead to answer them before reviewing, with review as the other way on", () => {
    const j = journey(f({ files: 3, items: 9, toReview: 6, accepted: 3, version: v1, openQuestions: 7 }));
    expect(j.title).toBe("Answer 7 questions about the gaps");
    expect(j.cta?.href).toBe("/check?tab=questions");
    expect(j.also).toEqual([{ label: "Review 6 items instead", href: "/review?tab=draft" }]);
    // The check stage is open again until the questions are answered.
    expect(j.stages[2].state).toBe("current");
  });
  it("offers them from a fresh build's check, too", () => {
    const j = journey(f({ files: 3, items: 9, toReview: 9, gaps: 2, openQuestions: 2 }));
    expect(j.cta?.href).toBe("/check");
    expect(j.also[0]).toEqual({ label: "Answer 2 questions about the gaps", href: "/check?tab=questions" });
  });
  it("does not ask while a mark waits for the advisor, and stops asking once answered", () => {
    const marked = { isCurrent: true, markedAt: "2026-11-10T09:00:00Z" };
    expect(journey(f({ files: 3, items: 9, accepted: 9, signoff: marked, openQuestions: 2 })).switchTo?.key).toBe("meena");
    expect(journey(f({ files: 3, items: 9, toReview: 2, accepted: 7, openQuestions: 0 })).title).toBe("Review 2 items");
  });
});

describe("progress", () => {
  it("puts review, not the check, as the current stage once reviewing has started", () => {
    const j = journey(f({ files: 3, items: 31, accepted: 1, toReview: 30 }));
    expect(j.stages[2].state).toBe("done");
    expect(j.stages[3].state).toBe("current");
    expect(j.title).toBe("Review 30 items");
  });
});

describe("advisor", () => {
  it("approves a current mark", () => {
    const j = journey(f({ role: "advisor", items: 9, accepted: 9, signoff: { isCurrent: true, markedAt: "2026-11-10T09:00:00Z" } }));
    expect(j.cta?.label).toBe("Review and approve");
  });
  it("does not offer approval for a mark older than the version", () => {
    const j = journey(f({ role: "advisor", items: 9, accepted: 9, version: v1, signoff: { isCurrent: true, markedAt: "2026-11-09T09:00:00Z" } }));
    expect(j.title).toBe("Version 1 is approved");
  });
  it("offers conflicts when nothing waits for approval", () => {
    expect(journey(f({ role: "advisor", items: 9, unruledConflicts: 2 })).cta?.href).toBe("/review?tab=conflicts");
  });
});

describe("incoming lead", () => {
  it("waits when nothing is approved", () => {
    const j = journey(f({ role: "incoming_lead" }));
    expect(j.title).toBe("Nothing has been handed over yet");
    expect(j.switchTo).not.toBeNull();
  });
  it("answers the items left", () => {
    const j = journey(f({ role: "incoming_lead", version: v1, answered: 1 }));
    expect(j.title).toBe("Answer 3 items");
  });
  it("is finished when every item is answered", () => {
    const j = journey(f({ role: "incoming_lead", version: v1, answered: 4 }));
    expect(j.doneCount).toBe(5);
    expect(j.title).toBe("You have answered every item");
  });
});

describe("awaitingApproval", () => {
  it("needs a current mark", () => {
    expect(awaitingApproval({ signoff: { isCurrent: false, markedAt: "2026-11-10T09:00:00Z" }, version: null })).toBe(false);
    expect(awaitingApproval({ signoff: null, version: null })).toBe(false);
  });
});

describe("every role gets a sensible next step", () => {
  it("never returns an empty title", () => {
    for (const role of ["outgoing_lead", "advisor", "incoming_lead", "treasurer", "member"] as const) {
      expect(journey(f({ role })).title.length).toBeGreaterThan(0);
      expect(journey(f({ role, version: v1 })).title.length).toBeGreaterThan(0);
    }
  });
});
