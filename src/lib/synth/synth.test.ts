import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUpload } from "../parsers/index.ts";
import { parseMinutesDocx } from "../parsers/minutes.ts";
import { renderDocx } from "./docx.ts";
import { fileBytes, fileLevels, generateScenario } from "./generate.ts";
import { checkTruth, loadTruth, type FileTexts } from "./truth.ts";
import { loadWorld } from "./world.ts";

// Every generated scenario: the year (an IoT club) and the photography club (a different cast
// and file shapes: iPhone committee chat, finance chat, private chat, Word minutes, no Trello).
const SCENARIOS = ["year", "photo"] as const;

for (const name of SCENARIOS) {
  const DIR = `data/scenarios/${name}/`;
  const worldText = readFileSync(DIR + "world.yaml", "utf8");
  const world = loadWorld(worldText);
  const files = generateScenario(world);
  const truth = loadTruth(readFileSync(DIR + "ground_truth.yaml", "utf8"));
  const text = (f: string) => {
    const c = files[f];
    return typeof c === "string" ? c : "";
  };

  async function parsed(): Promise<FileTexts> {
    const out: FileTexts = {};
    for (const [file, content] of Object.entries(files)) out[file] = (await parseUpload(file, fileBytes(content))).events.map((e) => e.text);
    return out;
  }

  describe(`${name} scenario generator`, () => {
    it("is deterministic: same world, same bytes", () => {
      expect(generateScenario(loadWorld(worldText))).toEqual(files);
    });

    it("a different seed changes the filler but not the planted messages", () => {
      const other = generateScenario(loadWorld(worldText.replace(/^seed: \d+$/m, "seed: 999")));
      const promise = truth.commitments.find((c) => c.quote.file === "whatsapp-committee.txt")!;
      expect(other["whatsapp-committee.txt"]).not.toBe(files["whatsapp-committee.txt"]);
      expect(other["whatsapp-committee.txt"]).toContain(promise.quote.text);
    });

    it("the committed files are up to date (run `pnpm gen:scenario`)", () => {
      for (const [file, content] of Object.entries(files)) expect(Buffer.from(readFileSync(DIR + file)).equals(Buffer.from(fileBytes(content))), file).toBe(true);
    });

    it("every file parses with its own parser and has volume", async () => {
      const texts = await parsed();
      expect(texts["whatsapp-committee.txt"].length).toBeGreaterThan(300);
      expect(texts[world.minutes.file]).toHaveLength(world.minutes.meetings.length);
      for (const [file, events] of Object.entries(texts)) expect(events.length, file).toBeGreaterThan(0);
    });

    it("every quote in ground_truth.yaml is in its file, and restricted text stays at its level", async () => {
      expect(checkTruth(truth, await parsed())).toEqual([]);
    });

    it("the truth names the same files, levels and uploaders as the world", () => {
      const levels = fileLevels(world);
      expect(Object.keys(truth.files).sort()).toEqual(Object.keys(levels).sort());
      for (const [file, meta] of Object.entries(levels)) expect([file, truth.files[file].accessLevel, truth.files[file].uploader]).toEqual([file, meta.accessLevel, meta.uploader]);
    });

    it("has a private file, finance text and private text for the leak tests", () => {
      expect(Object.values(truth.files).some((f) => f.accessLevel === "private")).toBe(true);
      expect(truth.restricted.some((r) => r.level === "finance")).toBe(true);
      expect(truth.restricted.some((r) => r.level === "private")).toBe(true);
    });

    it("filler holds no planted promise or decoy (each appears once)", () => {
      for (const d of truth.decoys) expect(text(d.file).split(d.text).length - 1, d.text).toBe(1);
      for (const c of truth.commitments.filter((x) => x.quote.file.endsWith(".txt"))) expect(text(c.quote.file).split(c.quote.text).length - 1, c.id).toBe(1);
    });

    it("filler never sounds like a promise", () => {
      for (const lines of Object.values(world.filler.templates)) for (const l of lines) expect(l, l).not.toMatch(/\b(I'll|I will|will|going to|promise)\b/i);
    });

    it("is labelled synthetic: the world, the truth, and every minutes or board file", () => {
      expect(worldText).toMatch(/SYNTHETIC/);
      expect(truth.synthetic).toBe(true);
      const labelled = [world.minutes.file, ...(world.trello ? [world.trello.file] : [])];
      for (const f of labelled) expect(Buffer.from(fileBytes(files[f])).toString("latin1"), f).toContain("SYNTHETIC");
    });
  });
}

describe("world checks", () => {
  const worldText = readFileSync("data/scenarios/year/world.yaml", "utf8");

  it("rejects a world with a person who does not exist", () => {
    expect(() => loadWorld(worldText.replace("by: Rohan, say: \"I'll set up", "by: Nobody, say: \"I'll set up"))).toThrow(/unknown person/);
  });

  it("rejects a one-to-one chat with more than two people", () => {
    expect(() => loadWorld(worldText.replace("members: [Dr. Meena, Arun]", "members: [Dr. Meena, Arun, Kavya]"))).toThrow(/exactly two members/);
  });

});

describe("Word minutes", () => {
  it("a generated .docx is read by the minutes parser with its heading dates", async () => {
    const bytes = renderDocx([
      { style: "Heading1", text: "Minutes (SYNTHETIC)" },
      { style: "Heading2", text: "3 March 2026: Committee meeting" },
      { boldLead: "Present:", text: " A, B" },
      { style: "Heading3", text: "Actions" },
      { text: "Asha to book the hall & the projector by 5 March." },
    ]);
    const r = await parseMinutesDocx(bytes);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].ts).toBe("2026-03-03T00:00:00+05:30");
    expect(r.events[0].text).toContain("Asha to book the hall & the projector by 5 March.");
    expect(r.events[0].text).toContain("Present: A, B");
  });

  it("the same paragraphs give the same bytes", () => {
    const ps = [{ style: "Heading2" as const, text: "1 June 2026: Committee meeting" }, { text: "Hello" }];
    expect(Buffer.from(renderDocx(ps)).equals(Buffer.from(renderDocx(ps)))).toBe(true);
  });

  it("the photo scenario's Word minutes parse without warnings, dates written in words", async () => {
    const r = await parseMinutesDocx(new Uint8Array(readFileSync("data/scenarios/photo/minutes.docx")));
    expect(r.summary.warnings).toEqual([]);
    expect(r.events.map((e) => e.ts?.slice(0, 10))).toEqual(["2026-06-12", "2026-08-07", "2026-09-26", "2026-10-30"]);
  });
});
