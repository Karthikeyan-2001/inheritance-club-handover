import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "./types";
import { parseWhatsApp } from "./whatsapp";

const read = (p: string) => readFileSync(p, "utf8");
const LRM = "‎";

// The exact sample format from the brief.
const BRIEF = [
  "24/10/2026, 10:14 am - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
  "24/10/2026, 10:15 am - Alex: Hey, are we still meeting for lunch today?",
  "24/10/2026, 10:17 am - Sam: Yes, let's meet at 12:30 pm.",
  "24/10/2026, 10:18 am - Alex: Sounds good! See you then.",
  "24/10/2026, 11:45 am - Sam: <Media omitted>",
  "24/10/2026, 12:05 pm - Sam: I'm running 5 minutes late.",
].join("\n");

describe("parseWhatsApp: Android format", () => {
  const r = parseWhatsApp(BRIEF);

  it("keeps ordinary messages and counts what it dropped", () => {
    expect(r.events.map((e) => [e.author, e.text])).toEqual([
      ["Alex", "Hey, are we still meeting for lunch today?"],
      ["Sam", "Yes, let's meet at 12:30 pm."],
      ["Alex", "Sounds good! See you then."],
      ["Sam", "I'm running 5 minutes late."],
    ]);
    expect(r.summary).toMatchObject({ unit: "message", rawUnits: 6, eventCount: 4, dropped: { system: 1, media: 1 } });
  });

  it("stamps IST, including noon", () => {
    expect(r.events.map((e) => e.ts)).toEqual([
      "2026-10-24T10:15:00+05:30",
      "2026-10-24T10:17:00+05:30",
      "2026-10-24T10:18:00+05:30",
      "2026-10-24T12:05:00+05:30",
    ]);
    expect(r.summary.first).toBe("2026-10-24T10:15:00+05:30");
    expect(r.summary.last).toBe("2026-10-24T12:05:00+05:30");
  });

  it("groups messages by IST day and has a source type", () => {
    expect(new Set(r.events.map((e) => e.threadId))).toEqual(new Set(["wa:2026-10-24"]));
    expect(r.events.every((e) => e.sourceType === "whatsapp")).toBe(true);
  });

  it("handles midnight (12:01 am) and 24-hour clocks", () => {
    const night = parseWhatsApp("25/10/2026, 12:01 am - Kavya: late one");
    expect(night.events[0].ts).toBe("2026-10-25T00:01:00+05:30");
    const h24 = parseWhatsApp("24/10/2026, 14:30 - Kavya: afternoon");
    expect(h24.events[0].ts).toBe("2026-10-24T14:30:00+05:30");
  });

  it("joins multi-line messages and trims the trailing newline", () => {
    const r2 = parseWhatsApp("24/10/2026, 10:05 am - Priya: Line one\nLine two\nLine three\n24/10/2026, 10:06 am - Arun: ok\n");
    expect(r2.events[0].text).toBe("Line one\nLine two\nLine three");
    expect(r2.events[1].text).toBe("ok");
  });

  it("drops deleted messages, both kinds, and counts them", () => {
    const r2 = parseWhatsApp(
      [
        "24/10/2026, 10:15 am - Priya: This message was deleted",
        "24/10/2026, 10:20 am - You deleted this message",
        "24/10/2026, 10:22 am - Arun: still here",
      ].join("\n"),
    );
    expect(r2.events).toHaveLength(1);
    expect(r2.summary.dropped).toEqual({ deleted: 2 });
  });

  it("strips the edited marker and records it", () => {
    const r2 = parseWhatsApp("24/10/2026, 10:16 am - Divya: Budget is ₹4,500 <This message was edited>");
    expect(r2.events[0].text).toBe("Budget is ₹4,500");
    expect(r2.events[0].meta).toEqual({ edited: true });
  });

  it("keeps unsaved-contact authors and non-Latin text", () => {
    const r2 = parseWhatsApp("24/10/2026, 10:12 am - +91 00000 00001: வணக்கம் 👍");
    expect(r2.events[0]).toMatchObject({ author: "+91 00000 00001", text: "வணக்கம் 👍" });
  });

  it("does not mistake a person's message for a system line", () => {
    const r2 = parseWhatsApp("24/10/2026, 10:12 am - Arun: I added the poster to the drive and left the key with Bala");
    expect(r2.events).toHaveLength(1);
    expect(r2.summary.dropped).toEqual({});
  });
});

describe("parseWhatsApp: iPhone format", () => {
  const text = [
    `[24/10/2026, 9:58:12 am] IoT Club Committee: ${LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.`,
    `[24/10/2026, 9:58:12 am] Priya: ${LRM}Priya created group “IoT Club Committee”`,
    "[24/10/2026, 10:01:30 am] Priya: Welcome all.",
    `[24/10/2026, 10:09:55 am] Kavya: ${LRM}<attached: 00000012-PHOTO-2026-10-24-10-09-55.jpg>`,
    `[24/10/2026, 10:10:20 am] Kavya: ${LRM}image omitted`,
    `[24/10/2026, 10:12:03 am] Priya: ${LRM}This message was deleted.`,
    `[24/10/2026, 10:16:44 am] Divya: Snacks ₹4,500 ${LRM}<This message was edited>`,
  ].join("\n");
  const r = parseWhatsApp(text);

  it("drops system lines that carry an author, attachments and deleted messages", () => {
    expect(r.events.map((e) => e.text)).toEqual(["Welcome all.", "Snacks ₹4,500"]);
    expect(r.summary.dropped).toEqual({ system: 2, media: 2, deleted: 1 });
  });

  it("stamps IST with seconds and leaves no invisible marks in kept text", () => {
    expect(r.events[0].ts).toBe("2026-10-24T10:01:30+05:30");
    expect(r.events.every((e) => !e.text.includes(LRM) && !(e.author ?? "").includes(LRM))).toBe(true);
    expect(r.events[1].meta).toEqual({ edited: true });
  });
});

describe("parseWhatsApp: dates and errors", () => {
  it("honours daysFirst", () => {
    const line = "03/04/2026, 10:00 am - A: x";
    expect(parseWhatsApp(line, { daysFirst: true }).events[0].ts).toBe("2026-04-03T10:00:00+05:30");
    expect(parseWhatsApp(line, { daysFirst: false }).events[0].ts).toBe("2026-03-04T10:00:00+05:30");
  });

  it("assumes day-first when every date is ambiguous", () => {
    expect(parseWhatsApp("03/04/2026, 10:00 am - A: x").events[0].ts).toBe("2026-04-03T10:00:00+05:30");
  });

  it("gives the same IST timestamps whatever the machine's time zone", () => {
    const zones = ["Asia/Kolkata", "UTC", "America/New_York", "Pacific/Auckland"];
    const original = process.env.TZ;
    try {
      const offsets = new Set<number>();
      const results = zones.map((tz) => {
        process.env.TZ = tz;
        offsets.add(new Date(2026, 6, 15, 12).getTimezoneOffset());
        return parseWhatsApp(BRIEF + "\n15/07/2026, 3:15 pm - Sam: summer").events.map((e) => e.ts);
      });
      expect(offsets.size, "the test must actually change the process time zone").toBeGreaterThan(1);
      for (const r of results) expect(r).toEqual(results[0]);
      expect(results[0]).toContain("2026-07-15T15:15:00+05:30");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("rejects empty input", () => {
    expect(() => parseWhatsApp("  \n ")).toThrowError(expect.objectContaining({ code: "empty" }));
  });

  it("explains an unrecognised format instead of returning nothing", () => {
    const attempt = () => parseWhatsApp("Just some text\nthat is not a chat export");
    expect(attempt).toThrow(ParseError);
    expect(attempt).toThrowError(/does not look like a WhatsApp chat export/);
    expect(attempt).toThrowError(expect.objectContaining({ code: "unsupported-format" }));
  });

  it("warns when a file contains only system lines", () => {
    const r = parseWhatsApp("24/10/2026, 9:58 am - Priya created group \"X\"\n24/10/2026, 9:58 am - Priya added you");
    expect(r.events).toHaveLength(0);
    expect(r.summary.warnings[0]).toMatch(/No ordinary messages/);
  });
});

describe("parseWhatsApp: sample files", () => {
  it("reads both small samples with the expected counts", () => {
    const a = parseWhatsApp(read("data/samples/whatsapp-android.txt"));
    expect(a.summary).toMatchObject({ rawUnits: 18, eventCount: 12, dropped: { system: 3, deleted: 2, media: 1 } });
    const i = parseWhatsApp(read("data/samples/whatsapp-iphone.txt"));
    expect(i.summary).toMatchObject({ rawUnits: 12, eventCount: 7, dropped: { system: 2, deleted: 1, media: 2 } });
    expect(a.events.find((e) => e.text.startsWith("Remember we need"))?.text).toContain("Please apply at least two weeks ahead.");
  });

  it("reads a year of committee chat: every message is either an event or counted as dropped", () => {
    const raw = read("data/samples/whatsapp-android-committee-year.txt");
    const headers = raw.split("\n").filter((l) => /^\d\d\/\d\d\/\d{4}, \d{1,2}:\d\d [ap]m - /.test(l)).length;
    const r = parseWhatsApp(raw);
    const dropped = Object.values(r.summary.dropped).reduce((a, b) => a + b, 0);
    expect(r.summary.rawUnits).toBe(headers);
    expect(r.events.length + dropped).toBe(headers);
    expect(r.events.length).toBeGreaterThan(2900);
    expect(r.summary.first?.startsWith("2025-11-01")).toBe(true);
    expect(r.summary.last?.startsWith("2026-10-31")).toBe(true);
    expect(r.events.every((e, i) => i === 0 || e.ts! >= r.events[i - 1].ts!)).toBe(true);
  });

  it("finds the planted commitments and a multi-line message in the year chat", () => {
    const r = parseWhatsApp(read("data/samples/whatsapp-android-committee-year.txt"));
    const texts = r.events.map((e) => e.text);
    expect(texts).toContain("Sure, I will get the permission letter signed by 31 October.");
    expect(texts).toContain("Reimbursed ₹2,400 to Mr. Ganesan, UPI screenshot above");
    const reminder = r.events.find((e) => e.text.startsWith("Folks, for the November workshop"));
    expect(reminder?.text.split("\n")).toHaveLength(3);
    expect(reminder?.ts).toBe("2025-11-03T20:15:00+05:30");
  });

  it("reads a year of volunteer chat in iPhone format", () => {
    const r = parseWhatsApp(read("data/samples/whatsapp-iphone-volunteers-year.txt"));
    expect(r.summary.dropped.system).toBe(3);
    expect(r.events.some((e) => e.text === "I'll bring 4 extension boards on 13 Feb evening.")).toBe(true);
    expect(r.events.every((e) => !e.text.includes(LRM))).toBe(true);
  });
});
