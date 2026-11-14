import { describe, expect, it } from "vitest";
import { ackSummary, canReplyTo, doneCommitments, handoverConflicts, dutyCalendar, dutyTiming, latestAckByItem, monthLabel, peopleWaiting, repliesByAck, statedQuotes, toHandoverItem, type HandoverItem } from "./handover.ts";

const base: HandoverItem = { id: "x", kind: "commitment", description: "d", owedBy: null, owedTo: null, dueText: null, dueDate: null, nextDue: null, startBy: null, cadence: null, approval: null, approver: null, status: "open", trust: "sourced" };
const mk = (o: Partial<HandoverItem>): HandoverItem => ({ ...base, ...o });

describe("toHandoverItem", () => {
  it("reads an obligation and blanks empty strings", () => {
    const i = toHandoverItem("1", { obligation: { kind: "recurring", description: "Renew", owed_to: "", next_due: "2027-01-05" } });
    expect(i).toMatchObject({ id: "1", kind: "recurring", owedTo: null, nextDue: "2027-01-05" });
  });
  it("returns null without an obligation", () => expect(toHandoverItem("1", {})).toBeNull());
});

describe("peopleWaiting", () => {
  it("groups open commitments by who they are owed to, soonest first, and leaves out fulfilled and recurring", () => {
    const g = peopleWaiting([
      mk({ id: "a", owedTo: "Mr. Bala", dueDate: "2027-04-20", description: "b" }),
      mk({ id: "b", owedTo: "Mr. Bala", dueDate: "2027-03-01", description: "a" }),
      mk({ id: "c", owedTo: "Mr. Bala", status: "fulfilled" }),
      mk({ id: "d", owedTo: "Asha" }),
      mk({ id: "e", kind: "recurring", owedTo: "Asha" }),
    ]);
    expect(g.map((x) => x.person)).toEqual(["Asha", "Mr. Bala"]);
    expect(g[1].items.map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("puts items with no stated person in a last group, and keeps undated items last", () => {
    const g = peopleWaiting([mk({ id: "a" }), mk({ id: "b", owedTo: "Zed" }), mk({ id: "c", owedTo: "Zed", dueDate: "2027-01-01" })]);
    expect(g.map((x) => x.person)).toEqual(["Zed", "Not stated who it is owed to"]);
    expect(g[0].items.map((i) => i.id)).toEqual(["c", "b"]);
  });
  it("is empty with nothing waiting", () => expect(peopleWaiting([])).toEqual([]));
});

describe("dutyCalendar", () => {
  const today = "2027-02-10";
  it("classifies timing", () => {
    expect(dutyTiming(mk({ nextDue: "2027-02-01" }), today)).toBe("overdue");
    expect(dutyTiming(mk({ nextDue: "2027-03-01", startBy: "2027-02-10" }), today)).toBe("start_now");
    expect(dutyTiming(mk({ nextDue: "2027-03-01", startBy: "2027-02-11" }), today)).toBe("upcoming");
    expect(dutyTiming(mk({ nextDue: null }), today)).toBe("undated");
  });
  it("orders recurring duties by next due with undated last", () => {
    const c = dutyCalendar([mk({ id: "u", kind: "recurring" }), mk({ id: "b", kind: "recurring", nextDue: "2027-06-01" }), mk({ id: "a", kind: "recurring", nextDue: "2027-03-01" }), mk({ id: "c" })], today);
    expect(c.map((e) => e.item.id)).toEqual(["a", "b", "u"]);
    expect(c[0].month).toBe("March 2027");
    expect(c[2].month).toBe("No date recorded");
  });
  it("formats months", () => {
    expect(monthLabel("2027-12-09")).toBe("December 2027");
    expect(monthLabel("garbage")).toBe("No date recorded");
  });
});

describe("acknowledgements", () => {
  const rows = [
    { obligation_id: "a", user_id: "u", action: "question" as const, note: "when?", created_at: "2027-01-01T00:00:00Z" },
    { obligation_id: "a", user_id: "u", action: "accept" as const, note: null, created_at: "2027-01-02T00:00:00Z" },
    { obligation_id: "b", user_id: "other", action: "decline" as const, note: "n", created_at: "2027-01-02T00:00:00Z" },
  ];
  it("the latest decision wins, and other users' are ignored", () => {
    const m = latestAckByItem(rows, "u");
    expect(m.get("a")?.action).toBe("accept");
    expect(m.has("b")).toBe(false);
  });
  it("counts items still waiting for an answer", () => {
    expect(ackSummary(["a", "b", "c"], latestAckByItem(rows, "u"))).toEqual({ accept: 1, question: 0, decline: 0, waiting: 2 });
  });
});

describe("replies to questions", () => {
  it("groups replies by the answer they reply to, oldest first", () => {
    const r = (id: string, ack: string, at: string) => ({ id, ack_id: ack, user_id: "arun", text: id, created_at: at });
    const m = repliesByAck([r("b", "q1", "2026-11-10T10:05:00+05:30"), r("a", "q1", "2026-11-10T10:00:00+05:30"), r("c", "q2", "2026-11-10T09:00:00+05:30")]);
    expect(m.get("q1")?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(m.get("q2")?.map((x) => x.id)).toEqual(["c"]);
    expect(m.get("q3")).toBeUndefined();
  });

  it("offers a reply only to a question or a decline", () => {
    expect(canReplyTo({ action: "question" })).toBe(true);
    expect(canReplyTo({ action: "decline" })).toBe(true);
    expect(canReplyTo({ action: "accept" })).toBe(false);
    expect(canReplyTo(undefined)).toBe(false);
  });
});

describe("doneCommitments", () => {
  it("lists fulfilled commitments (which are not waiting on anyone) and nothing else", () => {
    const items = [
      mk({ id: "a", description: "Zed done", status: "fulfilled" }),
      mk({ id: "b", description: "Still open", status: "open" }),
      mk({ id: "c", description: "Alpha done", status: "fulfilled" }),
      mk({ id: "d", description: "A duty", kind: "recurring", status: "fulfilled" }),
    ];
    expect(doneCommitments(items).map((i) => i.id)).toEqual(["c", "a"]);
    // Together with the waiting list, every commitment is on the page exactly once.
    const waiting = peopleWaiting(items).flatMap((g) => g.items.map((i) => i.id));
    expect([...waiting, ...doneCommitments(items).map((i) => i.id)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("statedQuotes", () => {
  const sources = new Map([
    ["e1", { author: "Arun", ts: "2026-11-14T10:00:00+05:30", type: "statement" }],
    ["e2", { author: "Priya", ts: "2026-02-01T10:00:00+05:30", type: "whatsapp" }],
    ["e3", { author: "Arun", ts: "2026-11-13T10:00:00+05:30", type: "statement" }],
  ]);
  const ev = (event_id: string, quote: string, relation = "supports") => ({ event_id, quote, relation });
  it("keeps only the outgoing lead's own answers, oldest first", () => {
    const out = statedQuotes([ev("e1", "Done: set up.", "fulfils"), ev("e2", "we will set up"), ev("e3", "Not done: set up.", "contradicts")], sources);
    expect(out.map((s) => [s.quote, s.relation])).toEqual([["Not done: set up.", "contradicts"], ["Done: set up.", "fulfils"]]);
  });
  it("ignores a message the viewer cannot read, and has none when there are none", () => {
    expect(statedQuotes([ev("hidden", "x")], sources)).toEqual([]);
    expect(statedQuotes([], sources)).toEqual([]);
  });
});

describe("handoverConflicts", () => {
  it("reads the two sides and the ruling an approved item carries", () => {
    const out = handoverConflicts({
      conflicts: [
        { id: "d1", summary: "Trello, 16 Mar 2026: says it was done. WhatsApp, 18 Mar 2026: says it was not.", quote_a: "Card moved to Done", quote_b: "nobody has sent them yet", ruling: "not_done", reason: "The speakers say so", ruled_at: "2026-11-14T10:00:00+05:30" },
        { id: "d2", quote_a: "done", quote_b: "", ruling: null, reason: null },
      ],
    });
    expect(out).toEqual([
      { id: "d1", summary: "Trello, 16 Mar 2026: says it was done. WhatsApp, 18 Mar 2026: says it was not.", saysDone: "Card moved to Done", saysNotDone: "nobody has sent them yet", ruling: "not_done", reason: "The speakers say so", ruledAt: "2026-11-14T10:00:00+05:30" },
      { id: "d2", summary: null, saysDone: "done", saysNotDone: null, ruling: null, reason: null, ruledAt: null },
    ]);
  });
  it("has none for older versions, odd shapes, and an unknown ruling word", () => {
    expect(handoverConflicts({})).toEqual([]);
    expect(handoverConflicts(null)).toEqual([]);
    expect(handoverConflicts({ conflicts: "x" })).toEqual([]);
    expect(handoverConflicts({ conflicts: [null, { summary: "no id" }] })).toEqual([]);
    expect(handoverConflicts({ conflicts: [{ id: "d", ruling: "maybe" }] })[0].ruling).toBeNull();
  });
});

