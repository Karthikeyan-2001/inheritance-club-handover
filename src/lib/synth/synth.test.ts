import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUpload } from "../parsers/index.ts";
import { generateScenario } from "./generate.ts";
import { checkTruth, loadTruth, type FileTexts } from "./truth.ts";
import { loadWorld } from "./world.ts";

const DIR = "data/scenarios/year/";
const worldText = readFileSync(DIR + "world.yaml", "utf8");
const world = loadWorld(worldText);
const files = generateScenario(world);
const truth = loadTruth(readFileSync(DIR + "ground_truth.yaml", "utf8"));

async function parsed(): Promise<FileTexts> {
  const out: FileTexts = {};
  for (const [name, content] of Object.entries(files)) out[name] = (await parseUpload(name, new TextEncoder().encode(content))).events.map((e) => e.text);
  return out;
}

describe("year scenario generator", () => {
  it("is deterministic: same world, same bytes", () => {
    expect(generateScenario(loadWorld(worldText))).toEqual(files);
  });

  it("a different seed changes the filler but not the planted messages", () => {
    const other = generateScenario(loadWorld(worldText.replace("seed: 11", "seed: 12")));
    const name = "whatsapp-committee.txt";
    expect(other[name]).not.toBe(files[name]);
    expect(other[name]).toContain("I'll get the lab permission letter signed by 31 October.");
  });

  it("the committed files are up to date (run `pnpm gen:scenario`)", () => {
    for (const [name, content] of Object.entries(files)) expect(readFileSync(DIR + name, "utf8"), name).toBe(content);
  });

  it("every file parses with its own parser and has volume", async () => {
    const texts = await parsed();
    expect(texts["whatsapp-committee.txt"].length).toBeGreaterThan(900);
    expect(texts["whatsapp-volunteers.txt"].length).toBeGreaterThan(400);
    expect(texts["trello-board.json"].length).toBeGreaterThan(30);
    expect(texts["minutes.md"]).toHaveLength(world.minutes.meetings.length);
  });

  it("every quote in ground_truth.yaml is in its file, and restricted amounts stay at their level", async () => {
    expect(checkTruth(truth, await parsed())).toEqual([]);
  });

  it("the truth names the same files and levels as the world", () => {
    for (const c of world.chats) expect(truth.files[c.file].accessLevel).toBe(c.accessLevel);
    expect(truth.files[world.trello.file].accessLevel).toBe(world.trello.accessLevel);
    expect(truth.files[world.minutes.file].accessLevel).toBe(world.minutes.accessLevel);
  });

  it("filler holds no planted promise or decoy (decoys appear once)", () => {
    for (const d of truth.decoys) expect(files[d.file].split(d.text).length - 1, d.text).toBe(1);
    for (const c of truth.commitments.filter((x) => x.quote.file.endsWith(".txt"))) expect(files[c.quote.file].split(c.quote.text).length - 1, c.id).toBe(1);
  });

  it("filler never sounds like a promise", () => {
    for (const lines of Object.values(world.filler.templates)) for (const l of lines) expect(l, l).not.toMatch(/\b(I'll|I will|will|going to|promise)\b/i);
  });

  it("rejects a world with a person who does not exist", () => {
    expect(() => loadWorld(worldText.replace("by: Rohan, say: \"I'll set up", "by: Nobody, say: \"I'll set up"))).toThrow(/unknown person/);
  });

  it("is labelled synthetic", () => {
    expect(worldText).toMatch(/SYNTHETIC/);
    expect(files["minutes.md"]).toMatch(/SYNTHETIC/);
    expect(files["trello-board.json"]).toMatch(/SYNTHETIC/);
  });
});
