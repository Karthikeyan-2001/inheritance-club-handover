import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUpload, type ParseResult } from "./index";

type Quote = { file: string; text: string };
type Truth = {
  files: Record<string, { type: string; accessLevel: string }>;
  commitments: { id: string; quote: Quote; evidence: (Quote & { relation: string })[] }[];
  recurring: { id: string; quotes: Quote[] }[];
  decoys: Quote[];
  contradictions: { id: string; claimA: Quote; claimB: Quote }[];
  expectedDropped: Record<string, Record<string, number>>;
};

const dir = "data/scenarios/mini/";
const truth: Truth = JSON.parse(readFileSync(dir + "ground-truth.json", "utf8"));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const parsed = new Map<string, ParseResult>();
for (const file of Object.keys(truth.files)) {
  parsed.set(file, await parseUpload(file, new Uint8Array(readFileSync(dir + file))));
}
const hit = (q: Quote) => parsed.get(q.file)!.events.find((e) => norm(e.text).includes(norm(q.text)));

describe("mini scenario: ground truth vs parsers", () => {
  it("reads all three files and drops exactly the expected chat noise", () => {
    expect([...parsed.keys()].sort()).toEqual(["minutes.md", "trello-board.json", "whatsapp-committee.txt"]);
    for (const [file, expected] of Object.entries(truth.expectedDropped)) {
      expect(parsed.get(file)!.summary.dropped, file).toEqual(expected);
    }
  });

  it.each(truth.commitments.map((c) => [c.id, c] as const))("commitment %s: its quote and evidence are verbatim in the parsed events", (_id, c) => {
    expect(hit(c.quote), `${c.id} quote`).toBeDefined();
    for (const ev of c.evidence) expect(hit(ev), `${c.id} ${ev.relation}`).toBeDefined();
  });

  it.each(truth.recurring.map((r) => [r.id, r] as const))("recurring duty %s: every quote is verbatim", (_id, r) => {
    for (const q of r.quotes) expect(hit(q), q.text).toBeDefined();
  });

  it("the decoys are present as ordinary events, so extraction has something to ignore", () => {
    for (const d of truth.decoys) expect(hit(d), d.text).toBeDefined();
  });

  it("the contradiction is visible as data: Done on Trello, then a chat message days later", () => {
    const x = truth.contradictions[0];
    const a = hit(x.claimA)!;
    const b = hit(x.claimB)!;
    expect(a.meta.movedToDone).toBe(true);
    expect(a.ts!.slice(0, 10)).toBe("2026-03-16");
    expect(b.ts!.slice(0, 10)).toBe("2026-03-18");
    expect(b.ts! > a.ts!).toBe(true);
  });

  it("the finance-restricted item lives only in the file marked finance", () => {
    const c2 = truth.commitments.find((c) => c.id === "C2")!;
    expect(truth.files[c2.quote.file].accessLevel).toBe("finance");
    for (const [file, r] of parsed) {
      if (file !== c2.quote.file) expect(r.events.some((e) => e.text.includes("₹2,400")), file).toBe(false);
    }
  });
});
