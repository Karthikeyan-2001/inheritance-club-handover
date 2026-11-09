import { describe, expect, it } from "vitest";
import {
  batchDutyEvents,
  buildDutyPrompt,
  dutyCandidates,
  monthIn,
  parseLeadTime,
  pastInstanceDays,
  postProcessDuties,
  schedule,
  type DutyOutput,
} from "./cycles";
import type { PipelineEvent } from "./extract";

const ev = (id: string, ts: string, text: string, over: Partial<PipelineEvent> = {}): PipelineEvent => ({
  id, author: "Priya", ts, text, threadId: "wa:2026-01-10", sourceType: "whatsapp", accessLevel: "committee", ...over,
});

const chatLab = ev("c1", "2026-01-10T19:35:00+05:30", "For the lab, remember the HoD's permission letter has to be approved before booking, every semester.\nLast sem they rejected us without it.");
const chatFest = ev("c2", "2026-01-10T19:30:00+05:30", "IoT Fest is our annual event. The auditorium needs the Dean's office approval, so apply a month ahead.");
const card = ev("t1", "2026-01-10T19:30:00+05:30", "Card: Get HoD permission letter for lab booking\nNeeded before every lab booking (every semester). Apply two weeks ahead.", { sourceType: "trello", threadId: "card1" });
const minutes = ev("m1", "2026-01-10T00:00:00+05:30", "Decisions\n\n- A signed HoD permission letter is required before every lab booking.", { sourceType: "minutes", accessLevel: "finance" });
const chatter = ev("x", "2026-01-11T10:00:00+05:30", "Lunch at 1?");
const signed = ev("s1", "2026-07-20T11:00:00+05:30", "HoD signed the permission letter, lab booked for August.");

describe("candidates and batches", () => {
  it("keeps messages that mention rules, cycles or approvals", () => {
    expect(dutyCandidates([chatLab, chatFest, card, minutes, chatter]).map((e) => e.id)).toEqual(["c1", "c2", "t1", "m1"]);
  });

  it("mixes source types but never visibility, least restricted first", () => {
    const priv = ev("p1", "2026-01-09T10:00:00+05:30", "Every year we renew.", { accessLevel: "private", uploaderId: "u1" });
    const priv2 = ev("p2", "2026-01-09T11:00:00+05:30", "Every year we renew too.", { accessLevel: "private", uploaderId: "u2" });
    const batches = batchDutyEvents([minutes, priv, chatLab, card, priv2, chatFest]);
    expect(batches.map((b) => b.map((e) => e.id))).toEqual([["c2", "t1", "c1"], ["m1"], ["p1"], ["p2"]]);
    expect(batchDutyEvents([chatLab, card, chatFest], 2).map((b) => b.length)).toEqual([2, 1]);
  });
});

describe("postProcessDuties", () => {
  const { refs } = buildDutyPrompt([chatFest, card, chatLab]);
  const r = (id: string) => [...refs.entries()].find(([, e]) => e.id === id)![0];
  const duty = (over: Partial<DutyOutput["duties"][number]> = {}): DutyOutput["duties"][number] => ({
    duty: "Get the HoD's permission letter before booking the lab",
    period: "semester",
    cadence_words: "every semester",
    when_words: null,
    approval: "Signed permission letter",
    approver: "HoD",
    lead_time_words: "two weeks ahead",
    usual_owner: null,
    quotes: [
      { message: r("c1"), quote: "the HoD's permission letter has to be approved before booking, every semester", role: "rule" },
      { message: r("t1"), quote: "Needed before every lab booking (every semester). Apply two weeks ahead.", role: "rule" },
      { message: r("c1"), quote: "Last sem they rejected us without it.", role: "past_instance" },
    ],
    ...over,
  });

  it("keeps a duty whose quotes verify and whose details appear in them", () => {
    const { kept, dropped } = postProcessDuties({ duties: [duty()] }, refs);
    expect(dropped).toEqual({});
    expect(kept[0]).toMatchObject({ period: "semester", cadence: "every semester", approver: "HoD", leadTime: "two weeks ahead" });
    expect(kept[0].quotes.map((q) => [q.event.id, q.relation])).toEqual([["c1", "supports"], ["t1", "supports"], ["c1", "past_instance"]]);
  });

  it("drops unverified quotes, and a duty with no statement of it", () => {
    const { kept, dropped } = postProcessDuties(
      {
        duties: [
          duty({ quotes: [{ message: r("c1"), quote: "the HoD must approve every booking", role: "rule" }, { message: "m9", quote: "x".repeat(20), role: "rule" }] }),
          duty({ quotes: [{ message: r("c1"), quote: "Last sem they rejected us without it.", role: "past_instance" }] }),
        ],
      },
      refs,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toEqual({ quote_not_found: 1, unknown_message: 1, no_rule: 2 });
  });

  it("needs cadence words that say it repeats, and quotes the sentence that holds them if the model did not", () => {
    const noCycle = postProcessDuties({ duties: [duty({ cadence_words: "before booking" })] }, refs);
    expect(noCycle.dropped).toEqual({ no_recurrence: 1 });
    const invented = postProcessDuties({ duties: [duty({ cadence_words: "every single month" })] }, refs);
    expect(invented.dropped).toEqual({ no_recurrence: 1 });

    const fest = postProcessDuties(
      {
        duties: [
          duty({
            duty: "Book the auditorium for IoT Fest", period: "year", cadence_words: "our annual event", approver: "Dean's office", lead_time_words: "a month ahead",
            quotes: [{ message: r("c2"), quote: "The auditorium needs the Dean's office approval, so apply a month ahead.", role: "rule" }],
          }),
        ],
      },
      refs,
    );
    expect(fest.dropped).toEqual({});
    expect(fest.kept[0].quotes.map((q) => q.quote)).toEqual(["The auditorium needs the Dean's office approval, so apply a month ahead.", "IoT Fest is our annual event."]);
  });

  it("blanks an approver or lead time that is not in the quotes", () => {
    const { kept, dropped } = postProcessDuties({ duties: [duty({ approver: "Principal", lead_time_words: "three weeks ahead", when_words: "every August" })] }, refs);
    expect(kept[0]).toMatchObject({ approver: null, leadTime: null, whenWords: null });
    expect(dropped).toEqual({ ungrounded_field: 3 });
  });

  it("merges the same duty listed twice, and refuses quotes that mix visibility", () => {
    const twice = postProcessDuties({ duties: [duty(), duty({ approver: null, lead_time_words: null, quotes: [{ message: r("t1"), quote: "Needed before every lab booking (every semester)", role: "rule" }] })] }, refs);
    expect(twice.kept).toHaveLength(1);
    expect(twice.kept[0].quotes).toHaveLength(4);
    expect(twice.dropped).toEqual({ duplicate: 1 });

    const mixed = buildDutyPrompt([chatLab, minutes]);
    const mr = (id: string) => [...mixed.refs.entries()].find(([, e]) => e.id === id)![0];
    const out = postProcessDuties(
      { duties: [duty({ lead_time_words: null, quotes: [{ message: mr("c1"), quote: "has to be approved before booking, every semester", role: "rule" }, { message: mr("m1"), quote: "A signed HoD permission letter is required before every lab booking.", role: "rule" }] })] },
      mixed.refs,
    );
    expect(out.kept).toHaveLength(0);
    expect(out.dropped).toEqual({ mixed_visibility: 1 });
  });

  it("collects past-instance days in IST", () => {
    const p = buildDutyPrompt([chatLab, signed]);
    const pr = (id: string) => [...p.refs.entries()].find(([, e]) => e.id === id)![0];
    const { kept } = postProcessDuties(
      { duties: [duty({ lead_time_words: null, quotes: [{ message: pr("c1"), quote: "has to be approved before booking, every semester", role: "rule" }, { message: pr("s1"), quote: "HoD signed the permission letter", role: "past_instance" }] })] },
      p.refs,
    );
    expect(pastInstanceDays(kept[0].quotes)).toEqual(["2026-07-20"]);
  });
});

describe("dates", () => {
  it("reads months and lead times from the quoted words", () => {
    expect(monthIn("every August")).toBe(8);
    expect(monthIn("in Sept")).toBe(9);
    expect(monthIn("every semester")).toBeNull();
    expect(parseLeadTime("a month ahead")).toEqual({ months: 1 });
    expect(parseLeadTime("two weeks ahead")).toEqual({ days: 14 });
    expect(parseLeadTime("10 days before")).toEqual({ days: 10 });
    expect(parseLeadTime("well ahead")).toBeNull();
  });

  const today = "2026-11-09";
  it("uses a stated month for a yearly duty, rolled past today, with start-by from the lead time", () => {
    expect(schedule({ period: "year", whenWords: "every August", leadTime: "a month ahead", pastInstances: [], today })).toEqual({
      nextDue: "2027-08-01", startBy: "2027-07-01", basis: 'Stated in the records: "every August"; start a month ahead',
    });
    expect(schedule({ period: "year", whenWords: "every December", leadTime: null, pastInstances: [], today }).nextDue).toBe("2026-12-01");
  });

  it("estimates from the last past instance, and says so", () => {
    expect(schedule({ period: "semester", whenWords: null, leadTime: "two weeks ahead", pastInstances: ["2025-11-13", "2026-07-20"], today })).toEqual({
      nextDue: "2027-01-20", startBy: "2027-01-06", basis: "Estimated: one semester after it was last recorded, on 20 Jul 2026; start two weeks ahead",
    });
    expect(schedule({ period: "year", whenWords: null, leadTime: null, pastInstances: ["2025-02-14"], today }).nextDue).toBe("2027-02-14");
    expect(schedule({ period: "month", whenWords: null, leadTime: null, pastInstances: ["2026-01-31"], today }).nextDue).toBe("2026-11-30");
  });

  it("gives no date when the records do not allow one", () => {
    const none = { nextDue: null, startBy: null, basis: null };
    expect(schedule({ period: "semester", whenWords: null, leadTime: "two weeks ahead", pastInstances: [], today })).toEqual(none);
    expect(schedule({ period: "each_time", whenWords: "every August", leadTime: null, pastInstances: ["2026-01-01"], today })).toEqual(none);
  });
});
