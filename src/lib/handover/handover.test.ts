import { describe, expect, it } from "vitest";
import { ackSummary, canReplyTo, dutyCalendar, dutyTiming, latestAckByItem, monthLabel, peopleWaiting, repliesByAck, toHandoverItem, type HandoverItem } from "./handover.ts";

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
