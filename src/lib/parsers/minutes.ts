import mammoth from "mammoth";
import { istIso } from "../time.ts";
import { ParseError, finish, type ParsedEvent, type ParseResult } from "./types.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNo = (name: string): number => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

type YMD = { y: number; m: number; d: number };

function valid(y: number, m: number, d: number): YMD | null {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
    ? { y, m, d }
    : null;
}

/**
 * Find a date in a heading. Understands 2026-08-14, 14 August 2026, August 14, 2026 and
 * 14/08/2026 (also . and -). Numeric dates are read day-first, as is usual in India.
 */
export function findDate(text: string): YMD | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => YMD | null][] = [
    [/(\d{4})-(\d{2})-(\d{2})/, (m) => valid(+m[1], +m[2], +m[3])],
    [new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})`, "i"), (m) => valid(+m[3], monthNo(m[2]), +m[1])],
    [new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i"), (m) => valid(+m[3], monthNo(m[1]), +m[2])],
    [/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/, (m) => valid(+m[3], +m[2], +m[1])],
  ];
  for (const [re, build] of patterns) {
    const m = text.match(re);
    const hit = m ? build(m) : null;
    if (hit) return hit;
  }
  return null;
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** mammoth's HTML is simple and predictable; turn it into the same markdown shape as .md files. */
export function htmlToMarkdown(html: string): string {
  return decode(
    html
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n${"#".repeat(+n)} ${inner}\n\n`)
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
      .replace(/<\/(ul|ol)>/gi, "\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove markdown decoration so quotes taken from the text match what a reader sees. */
function plain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Section = { level: number; title: string; ymd: YMD | null; lines: string[] };

function parseMarkdown(md: string): ParseResult {
  const lines = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = inFence ? null : line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const ymd = findDate(h[2]);
      if (ymd) {
        current = { level, title: h[2], ymd, lines: [] };
        sections.push(current);
        continue;
      }
      // A heading of the same or higher level that is not a meeting ends the current one.
      if (current && level <= current.level) current = null;
    }
    current?.lines.push(line);
  }

  const events: ParsedEvent[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  for (const s of sections) {
    const body = plain(s.lines.join("\n"));
    const text = body ? `${plain(s.title)}\n\n${body}` : plain(s.title);
    const ymd = s.ymd as YMD;
    const day = `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`;
    const n = (seen.get(day) ?? 0) + 1;
    seen.set(day, n);
    events.push({
      sourceType: "minutes",
      author: "Minutes",
      ts: istIso(ymd.y, ymd.m, ymd.d),
      text,
      threadId: n === 1 ? `minutes:${day}` : `minutes:${day}:${n}`,
      meta: { heading: s.title, dateOnly: true },
    });
  }

  if (sections.length === 0) {
    warnings.push(
      "No dated headings were found (for example '## 2026-08-14: Committee meeting'), so the whole file was kept as one undated entry.",
    );
    events.push({
      sourceType: "minutes",
      author: "Minutes",
      ts: null,
      text: plain(md),
      threadId: "minutes:undated",
      meta: { undated: true },
    });
  }
  return finish("minutes", "section", Math.max(sections.length, 1), events, {}, warnings);
}

/** Parse meeting minutes written in Markdown. Each dated heading becomes one event. */
export function parseMinutesMarkdown(text: string): ParseResult {
  if (!text.trim()) throw new ParseError("empty", "The minutes file is empty.");
  return parseMarkdown(text);
}

/** Parse meeting minutes from a Word (.docx) file, using Word's heading styles. */
export async function parseMinutesDocx(bytes: Uint8Array): Promise<ParseResult> {
  let html: string;
  let notes: string[];
  try {
    const res = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    html = res.value;
    notes = res.messages.filter((m) => m.type === "warning").map((m) => m.message);
  } catch {
    throw new ParseError("docx-unreadable", "This .docx file could not be read. Re-save it from Word as .docx and upload it again.");
  }
  const md = htmlToMarkdown(html);
  if (!md) throw new ParseError("empty", "The Word document has no text.");
  const result = parseMarkdown(md);
  const unique = [...new Set(notes)].slice(0, 5);
  result.summary.warnings.push(...unique.map((n) => `Word conversion: ${n}`));
  if (result.summary.warnings.some((w) => w.startsWith("No dated headings"))) {
    result.summary.warnings.push("Tip: dates must be in headings that use Word's Heading styles.");
  }
  return result;
}
