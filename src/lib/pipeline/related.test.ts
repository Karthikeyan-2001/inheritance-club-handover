import { beforeAll, describe, expect, it } from "vitest";
import { eventFor, miniEvents, type MiniEvent } from "../../../scripts/mini-scenario";
import { buildIdf, relatedEvents } from "./related";

let events: MiniEvent[];
beforeAll(async () => {
  events = await miniEvents();
});

const related = (quote: { file: string; text: string }, text: string, max?: number) => {
  const source = eventFor(events, quote)!;
  return relatedEvents({ text: `${text} ${quote.text}`, sourceEventIds: [source.id] }, events, buildIdf(events), max);
};

describe("relatedEvents", () => {
  it("finds the follow-ups of the certificates promise across chat and Trello, oldest first, with the promise itself", () => {
    const r = related({ file: "whatsapp-committee.txt", text: "we will send the participation certificates to all workshop speakers by 15 March" }, "Send participation certificates Arun Workshop speakers");
    const texts = r.map((e) => e.text);
    expect(texts.some((t) => t.includes("nobody has sent them yet"))).toBe(true);
    expect(texts.some((t) => t.startsWith('Moved card "Send certificates to workshop speakers"'))).toBe(true);
    expect(texts.some((t) => t.includes("participation certificates"))).toBe(true);
    expect(texts.some((t) => t.includes("sponsorship proposal"))).toBe(false);
    const times = r.map((e) => Date.parse(e.ts!));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("links a return to its promise through word forms (return/returned, boards/board)", () => {
    const r = related({ file: "whatsapp-committee.txt", text: "I'll return the borrowed ESP32 boards to Bala sir by Friday." }, "Return borrowed ESP32 boards Rohan Bala sir");
    expect(r.map((e) => e.text)).toContain("Returned all 8 boards, Bala sir signed the register");
  });

  it("caps the number of related messages, but always keeps the source", () => {
    const q = { file: "whatsapp-committee.txt", text: "I will have the fest posters printed by 3 Feb." };
    const r = related(q, "fest posters printed Kavya club", 1);
    expect(r).toHaveLength(2);
    expect(r.some((e) => e.id === eventFor(events, q)!.id)).toBe(true);
  });

  it("includes other actions on the same Trello card even without shared words", () => {
    const card = events.find((e) => e.text.startsWith("Card: Send certificates"))!;
    const r = relatedEvents({ text: "xyzzy", sourceEventIds: [card.id] }, events, buildIdf(events));
    expect(r.filter((e) => e.threadId === card.threadId).length).toBeGreaterThanOrEqual(3);
  });
});
