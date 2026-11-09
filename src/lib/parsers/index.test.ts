import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventSchema, ParseError, parseUpload, sourceTypeFor } from "./index";

const bytes = (p: string) => new Uint8Array(readFileSync(p));

describe("sourceTypeFor", () => {
  it.each([
    ["WhatsApp Chat with Club.txt", "whatsapp"],
    ["board.JSON", "trello"],
    ["minutes.md", "minutes"],
    ["minutes.docx", "minutes"],
    ["notes.pdf", null],
    ["noextension", null],
  ])("%s → %s", (name, type) => {
    expect(sourceTypeFor(name)).toBe(type);
  });
});

describe("parseUpload", () => {
  it("picks the right parser from the file name", async () => {
    expect((await parseUpload("a.txt", bytes("data/samples/whatsapp-android.txt"))).summary.sourceType).toBe("whatsapp");
    expect((await parseUpload("a.json", bytes("data/samples/trello-board.json"))).summary.sourceType).toBe("trello");
    expect((await parseUpload("a.md", bytes("data/samples/minutes.md"))).summary.sourceType).toBe("minutes");
    expect((await parseUpload("a.docx", bytes("data/samples/minutes.docx"))).summary.sourceType).toBe("minutes");
  });

  it("passes WhatsApp options through", async () => {
    const r = await parseUpload("a.txt", new TextEncoder().encode("03/04/2026, 10:00 am - A: x"), { whatsapp: { daysFirst: false } });
    expect(r.events[0].ts).toBe("2026-03-04T10:00:00+05:30");
  });

  it("refuses unsupported file types with a helpful message", async () => {
    await expect(parseUpload("notes.pdf", new Uint8Array([1]))).rejects.toThrow(ParseError);
    await expect(parseUpload("notes.pdf", new Uint8Array([1]))).rejects.toThrow(/WhatsApp .txt export/);
  });
});

describe("EventSchema", () => {
  const ok = { sourceType: "whatsapp", author: "A", ts: "2026-10-24T10:14:00+05:30", text: "hi", threadId: "wa:2026-10-24", meta: {} };

  it("accepts an IST event and a null timestamp", () => {
    expect(EventSchema.safeParse(ok).success).toBe(true);
    expect(EventSchema.safeParse({ ...ok, ts: null, author: null }).success).toBe(true);
  });
  it("rejects timestamps that are not IST, and empty text", () => {
    expect(EventSchema.safeParse({ ...ok, ts: "2026-10-24T10:14:00Z" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, ts: "2026-10-24T10:14:00+00:00" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, text: "" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, sourceType: "email" }).success).toBe(false);
  });
});
