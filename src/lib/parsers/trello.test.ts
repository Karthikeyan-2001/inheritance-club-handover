import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrello } from "./trello";

const read = (p: string) => readFileSync(p, "utf8");
const board = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "B",
    members: [{ id: "m1", fullName: "Arun" }],
    lists: [{ id: "l1", name: "To Do" }, { id: "l2", name: "Done" }],
    cards: [{ id: "c1", name: "Card one", desc: "", idList: "l1", dateLastActivity: "2026-10-24T09:00:00.000Z" }],
    actions: [],
    ...over,
  });

describe("parseTrello: small sample", () => {
  const r = parseTrello(read("data/samples/trello-board.json"));
  const byMeta = (key: string, value: string) => r.events.filter((e) => e.meta[key] === value);

  it("emits a card event with description and due date, stamped at creation in IST", () => {
    const card = r.events.find((e) => e.meta.cardName === "Get HoD permission letter for lab booking" && e.meta.trello === "card")!;
    expect(card.text).toBe(
      "Card: Get HoD permission letter for lab booking\nNeeded before every lab booking (every semester). Apply two weeks ahead.\nDue: 2026-10-31",
    );
    expect(card.author).toBe("Priya");
    expect(card.ts).toBe("2026-10-24T14:30:00+05:30"); // created 09:00 UTC
    expect(card.threadId).toMatch(/^trello:card:/);
    expect(card.meta).toMatchObject({ list: "To Do", dueComplete: false, closed: false });
  });

  it("turns comments into events authored by the commenter", () => {
    const c = byMeta("trello", "commentCard");
    expect(c.map((e) => [e.author, e.text])).toEqual(
      expect.arrayContaining([
        ["Priya", "Speakers are saying they have not received the certificates yet."],
        ["Arun", "Draft is ready, taking it to the HoD's office on Monday."],
      ]),
    );
  });

  it("records list moves and flags moves into Done", () => {
    const moves = byMeta("trello", "updateCard");
    const toDone = moves.find((e) => e.text.includes("Send certificates"))!;
    expect(toDone.text).toBe('Moved card "Send certificates to workshop speakers" from "To Do" to "Done"');
    expect(toDone.meta).toMatchObject({ from: "To Do", to: "Done", movedToDone: true });
    expect(toDone.ts).toBe("2026-10-16T16:00:00+05:30");
  });

  it("describes member additions by name and keeps checklists labelled as export-time state", () => {
    expect(r.events.some((e) => e.text === 'Added Arun to card "Get HoD permission letter for lab booking"')).toBe(true);
    const cl = byMeta("trello", "checklist")[0];
    expect(cl.text).toBe('Checklist "Steps" on card "Get HoD permission letter for lab booking" (state at export):\n- [x] Draft the letter\n- [ ] Get HoD signature');
    expect(cl.meta.tsSource).toBe("export");
  });

  it("orders events by time and reports a clean summary", () => {
    expect(r.events.every((e, i) => i === 0 || e.ts! >= r.events[i - 1].ts!)).toBe(true);
    expect(r.summary).toMatchObject({ unit: "action", rawUnits: 11, eventCount: 10, dropped: {} });
  });
});

describe("parseTrello: edge cases", () => {
  it("falls back to dateLastActivity when there is no action history, and says so", () => {
    const r = parseTrello(board());
    expect(r.events).toHaveLength(1);
    expect(r.events[0].ts).toBe("2026-10-24T14:30:00+05:30");
    expect(r.events[0].meta.tsSource).toBe("dateLastActivity");
    expect(r.summary.warnings[0]).toMatch(/no action history/);
  });

  it("keeps a card with no date at all, with a null timestamp sorted last", () => {
    const r = parseTrello(board({ cards: [{ id: "c1", name: "Undated" }, { id: "c2", name: "Dated", dateLastActivity: "2026-01-01T00:00:00.000Z" }] }));
    expect(r.events.map((e) => e.ts)).toEqual(["2026-01-01T05:30:00+05:30", null]);
    expect(r.summary.first).toBe("2026-01-01T05:30:00+05:30");
  });

  it("handles completion, due-date changes and archiving", () => {
    const act = (id: string, data: object) => ({ id, type: "updateCard", date: "2026-02-01T10:00:00.000Z", idMemberCreator: "m1", data });
    const r = parseTrello(
      board({
        actions: [
          act("a1", { card: { id: "c1", name: "Card one", dueComplete: true }, old: { dueComplete: false } }),
          act("a2", { card: { id: "c1", name: "Card one", due: "2026-03-01T06:30:00.000Z" }, old: { due: null } }),
          act("a3", { card: { id: "c1", name: "Card one", closed: true }, old: { closed: false } }),
        ],
      }),
    );
    const texts = r.events.map((e) => e.text);
    expect(texts).toContain('Marked card "Card one" as complete');
    expect(texts).toContain('Changed due date of card "Card one" to 2026-03-01');
    expect(texts).toContain('Archived card "Card one"');
    expect(r.events.find((e) => e.text.startsWith("Marked"))?.author).toBe("Arun");
  });

  it("counts action types it does not turn into events", () => {
    const r = parseTrello(
      board({ actions: [{ id: "a1", type: "updateBoard", date: "2026-02-01T10:00:00.000Z", data: {} }] }),
    );
    expect(r.summary.dropped).toEqual({ unknown_action: 1 });
  });

  it("counts actions with an unusable date", () => {
    const r = parseTrello(board({ actions: [{ id: "a1", type: "commentCard", date: "not a date", data: { card: { id: "c1", name: "Card one" }, text: "hi" } }] }));
    expect(r.summary.dropped).toEqual({ bad_date: 1 });
  });

  it("rejects empty, invalid and non-Trello files with a clear code", () => {
    expect(() => parseTrello("")).toThrowError(expect.objectContaining({ code: "empty" }));
    expect(() => parseTrello("{not json")).toThrowError(expect.objectContaining({ code: "invalid-json" }));
    expect(() => parseTrello('{"foo": 1}')).toThrowError(expect.objectContaining({ code: "not-trello-board" }));
    expect(() => parseTrello("[1,2,3]")).toThrowError(expect.objectContaining({ code: "not-trello-board" }));
    expect(() => parseTrello('{"foo": 1}')).toThrowError(/"cards" list is required/);
  });
});

describe("parseTrello: year board", () => {
  const r = parseTrello(read("data/samples/trello-board-year.json"));
  const move = (card: string, to: string) =>
    r.events.find((e) => e.meta.cardName === card && e.meta.to === to)!;

  it("reads every card and a lot of history", () => {
    expect(r.events.filter((e) => e.meta.trello === "card")).toHaveLength(25);
    expect(r.summary.rawUnits).toBe(25 + 94);
    expect(r.summary.dropped).toEqual({});
  });

  it("shows the planted contradiction: Done on 16 Mar, comment on 20 Mar says otherwise", () => {
    const done = move("Send certificates to workshop speakers", "Done");
    expect(done.meta.movedToDone).toBe(true);
    expect(done.ts!.slice(0, 10)).toBe("2026-03-16");
    const comment = r.events.find((e) => e.meta.trello === "commentCard" && e.text.includes("still saying they have not received"))!;
    expect(comment.ts! > done.ts!).toBe(true);
    expect(comment.threadId).toBe(done.threadId);
  });

  it("leaves the open permission-letter card in To Do", () => {
    const card = r.events.find((e) => e.meta.trello === "card" && e.meta.cardName === "Get HoD permission letter for lab booking")!;
    expect(card.meta.list).toBe("To Do");
    expect(card.meta.dueComplete).toBe(false);
  });
});
