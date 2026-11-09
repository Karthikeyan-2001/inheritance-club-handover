import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findDate, htmlToMarkdown, parseMinutesDocx, parseMinutesMarkdown } from "./minutes";

const read = (p: string) => readFileSync(p, "utf8");
const bytes = (p: string) => new Uint8Array(readFileSync(p));

describe("findDate", () => {
  it.each([
    ["2026-08-14: Committee meeting", { y: 2026, m: 8, d: 14 }],
    ["14 August 2026: Committee meeting", { y: 2026, m: 8, d: 14 }],
    ["14th Aug, 2026", { y: 2026, m: 8, d: 14 }],
    ["Sept 5 2026 meeting", { y: 2026, m: 9, d: 5 }],
    ["August 14, 2026", { y: 2026, m: 8, d: 14 }],
    ["Meeting on 14/08/2026", { y: 2026, m: 8, d: 14 }],
    ["Meeting 05.03.2026", { y: 2026, m: 3, d: 5 }],
  ])("reads %s", (heading, expected) => {
    expect(findDate(heading)).toEqual(expected);
  });

  it.each(["Agenda", "Version 2.0", "31 February 2026", "2026-13-40", "30/02/2026"])("finds no date in %s", (heading) => {
    expect(findDate(heading)).toBeNull();
  });
});

describe("parseMinutesMarkdown", () => {
  const md = [
    "# Club minutes",
    "",
    "Some preamble that belongs to no meeting.",
    "",
    "## 2026-08-14: Committee meeting",
    "",
    "**Present:** Priya, Arun",
    "",
    "### Decisions",
    "",
    "- Lab needs the `HoD` letter.",
    "",
    "## Appendix",
    "",
    "Not part of any meeting.",
    "",
    "## 9 September 2026: Special meeting",
    "",
    "- Elections on 28 November.",
  ].join("\n");
  const r = parseMinutesMarkdown(md);

  it("makes one event per dated heading, in IST, with nested headings kept inside", () => {
    expect(r.events.map((e) => e.ts)).toEqual(["2026-08-14T00:00:00+05:30", "2026-09-09T00:00:00+05:30"]);
    expect(r.events[0].text).toContain("Decisions");
    expect(r.events[0].threadId).toBe("minutes:2026-08-14");
    expect(r.events[0].author).toBe("Minutes");
    expect(r.summary).toMatchObject({ unit: "section", rawUnits: 2, eventCount: 2 });
  });

  it("strips markdown decoration, and ends a meeting at a non-meeting heading", () => {
    expect(r.events[0].text).toBe(
      "2026-08-14: Committee meeting\n\nPresent: Priya, Arun\n\nDecisions\n\n- Lab needs the HoD letter.",
    );
    expect(r.events[0].text).not.toContain("Not part of any meeting");
    expect(r.events.every((e) => !e.text.includes("Some preamble"))).toBe(true);
  });

  it("gives repeated dates distinct thread ids", () => {
    const two = parseMinutesMarkdown("## 2026-08-14: Morning\n- a\n\n## 2026-08-14: Evening\n- b");
    expect(two.events.map((e) => e.threadId)).toEqual(["minutes:2026-08-14", "minutes:2026-08-14:2"]);
  });

  it("does not treat # inside code fences as headings", () => {
    const r2 = parseMinutesMarkdown("## 2026-08-14: Meeting\n```\n## 2026-01-01 not a meeting\n```\n- ok");
    expect(r2.events).toHaveLength(1);
  });

  it("keeps an undated file as one undated entry and warns", () => {
    const r2 = parseMinutesMarkdown("# Notes\n\nWe agreed to meet again.");
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0]).toMatchObject({ ts: null, threadId: "minutes:undated", meta: { undated: true } });
    expect(r2.summary.warnings[0]).toMatch(/No dated headings/);
    expect(r2.summary.first).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(() => parseMinutesMarkdown("   \n")).toThrowError(expect.objectContaining({ code: "empty" }));
  });

  it("reads the small and year-long samples", () => {
    const small = parseMinutesMarkdown(read("data/samples/minutes.md"));
    expect(small.events.map((e) => e.ts!.slice(0, 10))).toEqual(["2026-08-14", "2026-09-11"]);
    const year = parseMinutesMarkdown(read("data/samples/minutes-2025-11-to-2026-04.md"));
    expect(year.events).toHaveLength(6);
    expect(year.events[0].ts).toBe("2025-11-08T00:00:00+05:30");
    expect(year.events[0].text).toContain("A signed HoD permission letter is required before every lab booking, every semester.");
    expect(year.events[0].text).not.toMatch(/\*\*|^#/m);
  });
});

describe("htmlToMarkdown", () => {
  it("converts mammoth-style html", () => {
    expect(htmlToMarkdown("<h2>Title</h2><p>Hello &amp; <strong>bye</strong></p><ul><li>one</li><li>two</li></ul>")).toBe(
      "## Title\n\nHello & bye\n\n- one\n- two",
    );
  });
});

describe("parseMinutesDocx", () => {
  it("reads Word headings with textual dates", async () => {
    const r = await parseMinutesDocx(bytes("data/samples/minutes.docx"));
    expect(r.events.map((e) => e.ts)).toEqual(["2026-10-09T00:00:00+05:30", "2026-10-23T00:00:00+05:30"]);
    expect(r.events[0].text).toContain("Present: Priya, Arun, Kavya, Divya");
    expect(r.events[0].text).toContain("Lab access needs the HoD's permission letter before the booking is made.");
    expect(r.summary.warnings).toEqual([]);
  });

  it("reads the six-meeting year file and keeps ₹ and apostrophes intact", async () => {
    const r = await parseMinutesDocx(bytes("data/samples/minutes-2026-05-to-2026-10.docx"));
    expect(r.events).toHaveLength(6);
    expect(r.events.map((e) => e.ts!.slice(0, 10))).toEqual([
      "2026-05-09", "2026-06-13", "2026-07-18", "2026-08-08", "2026-09-12", "2026-10-10",
    ]);
    expect(r.events[3].text).toContain("Budget of ₹6,000 approved.");
    expect(r.events[2].text).toContain("the renewal needs the Dean's signature");
  });

  it("rejects a file that is not a Word document", async () => {
    await expect(parseMinutesDocx(new TextEncoder().encode("plain text, not a zip"))).rejects.toMatchObject({ code: "docx-unreadable" });
  });
});
