import { describe, expect, it } from "vitest";
import { startByFor } from "./pipeline/cycles";
import {
  ANSWERS_FOR,
  ANSWER_LABELS,
  answerSummary,
  dayInWords,
  gapQuestions,
  levelChoices,
  openCount,
  rolesLosingSight,
  statementText,
  type QuestionAnswer,
  type QuestionItem,
} from "./questions";

const item = (over: Partial<QuestionItem> & { id: string }): QuestionItem => ({
  kind: "commitment",
  description: "set up the demo kits",
  status: "open",
  access_level: "committee",
  review_state: "accepted",
  approval_required: null,
  approver: null,
  next_due: null,
  lead_time: null,
  ...over,
});
const answer = (over: Partial<QuestionAnswer> & Pick<QuestionAnswer, "obligation_id" | "question" | "answer">): QuestionAnswer => ({
  docket_entry_id: null,
  created_at: "2026-11-14T10:00:00+05:30",
  text: null,
  access_level: "committee",
  ...over,
});

describe("gapQuestions", () => {
  it("asks about a promise with no follow-up, and not about one that has some", () => {
    const qs = gapQuestions([item({ id: "a", status: "no_evidence" }), item({ id: "b", status: "fulfilled" }), item({ id: "c", status: "open" })], [], []);
    expect(qs.map((q) => [q.key, q.state, q.ask])).toEqual([["followup:a", "open", "Was this done?"]]);
  });

  it("asks about each unruled conflict, by its entry, and not about a ruled one", () => {
    const qs = gapQuestions(
      [item({ id: "a", status: "contradicted" })],
      [
        { id: "d1", obligation_id: "a", ruling: null, summary: "Trello, 16 Mar 2026: says it was done. WhatsApp, 18 Mar 2026: says it was not." },
        { id: "d2", obligation_id: "a", ruling: "done", summary: "x" },
      ],
      [],
    );
    expect(qs.map((q) => [q.key, q.entryId, q.detail?.slice(0, 6)])).toEqual([["conflict:d1", "d1", "Trello"]]);
  });

  it("asks about a duty's approver and its next date separately", () => {
    const qs = gapQuestions([item({ id: "r", kind: "recurring", approval_required: "the HoD's permission letter" })], [], []);
    expect(qs.map((q) => [q.question, q.ask])).toEqual([
      ["approver", "Who gives the HoD's permission letter?"],
      ["date", "When is it next due?"],
    ]);
    const none = gapQuestions([item({ id: "r", kind: "recurring" })], [], []);
    expect(none[0].ask).toBe("Does this need anyone's approval?");
    expect(gapQuestions([item({ id: "r", kind: "recurring", approver: "HoD", next_due: "2027-01-01" })], [], [])).toEqual([]);
  });

  it("asks nothing about a rejected item", () => {
    expect(gapQuestions([item({ id: "a", status: "no_evidence", review_state: "rejected" })], [], [])).toEqual([]);
  });

  it("keeps an answered question in the list, as answered, after its gap is closed", () => {
    const qs = gapQuestions([item({ id: "a", status: "fulfilled" })], [], [answer({ obligation_id: "a", question: "followup", answer: "done", text: "Done: set up the demo kits." })]);
    expect(qs.map((q) => [q.key, q.state, q.answers.length])).toEqual([["followup:a", "answered", 1]]);
  });

  it("counts a question answered even while its gap stays (no approval needed; a conflict awaiting a ruling)", () => {
    const qs = gapQuestions(
      [item({ id: "r", kind: "recurring", next_due: "2027-01-01" }), item({ id: "a", status: "contradicted" })],
      [{ id: "d1", obligation_id: "a", ruling: null, summary: "s" }],
      [
        answer({ obligation_id: "r", question: "approver", answer: "no_approval" }),
        answer({ obligation_id: "a", question: "conflict", answer: "done", docket_entry_id: "d1" }),
      ],
    );
    expect(qs.map((q) => [q.key, q.state])).toEqual([["conflict:d1", "answered"], ["approver:r", "answered"]]);
  });

  it("leaves a question open on purpose after \"I don't know\", and lists it after the open ones", () => {
    const qs = gapQuestions(
      [item({ id: "a", status: "no_evidence" }), item({ id: "b", status: "no_evidence" })],
      [],
      [answer({ obligation_id: "a", question: "followup", answer: "unknown" })],
    );
    expect(qs.map((q) => [q.key, q.state])).toEqual([["followup:b", "open"], ["followup:a", "left_open"]]);
    expect(openCount(qs)).toBe(1);
  });

  it("orders open questions by kind, then by the items' order", () => {
    const qs = gapQuestions(
      [item({ id: "r", kind: "recurring", approver: "HoD" }), item({ id: "b", status: "no_evidence" }), item({ id: "a", status: "no_evidence" })],
      [],
      [],
    );
    expect(qs.map((q) => q.key)).toEqual(["followup:b", "followup:a", "date:r"]);
  });

  it("an answer whose question is gone and was never answered asks nothing (empty state)", () => {
    expect(gapQuestions([], [], [])).toEqual([]);
  });
});

describe("answers and levels", () => {
  it("each question has its own answers, with a label for each", () => {
    for (const [q, list] of Object.entries(ANSWERS_FOR)) {
      for (const a of list) expect(ANSWER_LABELS[q as keyof typeof ANSWERS_FOR][a], `${q}/${a}`).toBeTruthy();
    }
    expect(ANSWERS_FOR.date).not.toContain("done");
  });

  it("an answer may be as restricted as the item or more, never less", () => {
    expect(levelChoices("everyone")).toEqual(["everyone", "committee", "finance", "private"]);
    expect(levelChoices("committee")).toEqual(["committee", "finance", "private"]);
    expect(levelChoices("private")).toEqual(["private"]);
  });

  it("says who would lose sight of the item when an answer raises it", () => {
    expect(rolesLosingSight("committee", "committee", "done")).toEqual([]);
    expect(rolesLosingSight("committee", "finance", "done")).toEqual(["Incoming lead"]);
    expect(rolesLosingSight("everyone", "finance", "approver")).toEqual(["Incoming lead", "Member"]);
    expect(rolesLosingSight("committee", "private", "not_done")).toEqual(["Treasurer", "Incoming lead"]);
    // "I don't know" is a note with its own level: the item is not raised.
    expect(rolesLosingSight("committee", "finance", "unknown")).toEqual([]);
  });
});

describe("statementText (mirrors answer_gap() in migration 0022)", () => {
  const base = { description: "set up the demo kits.", detail: null };
  it("writes the message from the answer and the item", () => {
    expect(statementText({ ...base, question: "followup", answer: "done" })).toBe("Done: set up the demo kits.");
    expect(statementText({ ...base, question: "conflict", answer: "not_done" })).toBe("Not done: set up the demo kits.");
    expect(statementText({ ...base, question: "approver", answer: "approver", approver: "  the  HoD " })).toBe("Needs approval from the HoD: set up the demo kits.");
    expect(statementText({ ...base, question: "approver", answer: "no_approval" })).toBe("No approval is needed: set up the demo kits.");
    expect(statementText({ ...base, question: "date", answer: "date", nextDue: "2027-01-05" })).toBe("Next due on 5 Jan 2027: set up the demo kits.");
    expect(statementText({ ...base, question: "followup", answer: "unknown" })).toBe("Not known whether it was done: set up the demo kits.");
    expect(statementText({ ...base, question: "approver", answer: "unknown" })).toBe("Not known who approves it: set up the demo kits.");
    expect(statementText({ ...base, question: "date", answer: "unknown" })).toBe("Not known when it is next due: set up the demo kits.");
  });
  it("adds the lead's own words after it, with spaces tidied", () => {
    expect(statementText({ ...base, question: "followup", answer: "done", detail: "  Kits were  ready \n on the day. " })).toBe("Done: set up the demo kits. Kits were ready on the day.");
  });
  it("writes dates as Postgres does", () => {
    expect(dayInWords("2026-11-30")).toBe("30 Nov 2026");
    expect(dayInWords("not a date")).toBe("not a date");
  });
});

describe("answerSummary and startByFor", () => {
  it("says what each answer did, and that a conflict still needs the advisor", () => {
    expect(answerSummary({ question: "conflict", answer: "done" })).toMatch(/advisor rules/);
    expect(answerSummary({ question: "followup", answer: "unknown" })).toMatch(/answer later/);
    expect(answerSummary({ question: "followup", answer: "not_done" })).toMatch(/still owed/);
  });
  it("works out a start date from a stated lead time, or none", () => {
    expect(startByFor("2027-01-15", "two weeks before")).toBe("2027-01-01");
    expect(startByFor("2027-03-31", "a month ahead")).toBe("2027-02-28");
    expect(startByFor("2027-01-15", "well in advance")).toBeNull();
    expect(startByFor("2027-01-15", null)).toBeNull();
  });
});
