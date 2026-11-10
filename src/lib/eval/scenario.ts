// Load a scenario (data/scenarios/<name>/, SYNTHETIC) as pipeline events plus its ground truth,
// for the eval script and the tests. Works for the hand-written mini scenario (ground-truth.json)
// and for generated ones (ground_truth.yaml). Event ids are "<file>#<index>"; each event carries
// its file's access level, and private files carry their uploader (a demo account key).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { AccessLevel } from "../access.ts";
import { parseUpload } from "../parsers/index.ts";
import type { PipelineEvent } from "../pipeline/extract.ts";
import { normaliseForQuote } from "../pipeline/verify.ts";
import { TruthSchema, loadTruth, type Truth } from "../synth/truth.ts";

export const SCENARIO_ROOT = "data/scenarios/";

export type ScenarioEvent = PipelineEvent & { file: string; accessLevel: AccessLevel };
export type ScenarioFile = { name: string; bytes: Uint8Array; type: Truth["files"][string]["type"]; accessLevel: AccessLevel; uploader: Truth["files"][string]["uploader"] };
export type Scenario = { name: string; truth: Truth; files: ScenarioFile[]; events: ScenarioEvent[] };
export type Quote = { file: string; text: string };

/** Scenario names: every directory under data/scenarios with a ground truth. */
export function scenarioNames(): string[] {
  return readdirSync(SCENARIO_ROOT)
    .filter((d) => existsSync(`${SCENARIO_ROOT}${d}/ground_truth.yaml`) || existsSync(`${SCENARIO_ROOT}${d}/ground-truth.json`))
    .sort();
}

/** The truth of a scenario. The mini scenario's JSON predates `due`, `appears` and `restricted`; they default to empty. */
export function scenarioTruth(name: string): Truth {
  const dir = `${SCENARIO_ROOT}${name}/`;
  if (existsSync(dir + "ground_truth.yaml")) return loadTruth(readFileSync(dir + "ground_truth.yaml", "utf8"));
  const raw = JSON.parse(readFileSync(dir + "ground-truth.json", "utf8")) as Record<string, unknown> & { commitments: object[]; recurring: object[] };
  return TruthSchema.parse({
    ...raw,
    synthetic: true,
    commitments: raw.commitments.map((c) => ({ due: null, ...c })),
    recurring: raw.recurring.map((r) => ({ appears: [], ...r })),
    restricted: [],
  });
}

export async function loadScenario(name: string): Promise<Scenario> {
  const dir = `${SCENARIO_ROOT}${name}/`;
  if (!existsSync(dir)) throw new Error(`No scenario called "${name}". Known: ${scenarioNames().join(", ")}.`);
  const truth = scenarioTruth(name);
  const files: ScenarioFile[] = [];
  const events: ScenarioEvent[] = [];
  for (const [file, meta] of Object.entries(truth.files)) {
    const bytes = new Uint8Array(readFileSync(dir + file));
    files.push({ name: file, bytes, ...meta });
    const r = await parseUpload(file, bytes);
    r.events.forEach((e, i) =>
      events.push({
        id: `${file}#${i}`, file, sourceId: file, author: e.author, ts: e.ts, text: e.text, threadId: e.threadId, sourceType: e.sourceType,
        accessLevel: meta.accessLevel, uploaderId: meta.accessLevel === "private" ? meta.uploader : null,
      }),
    );
  }
  return { name, truth, files, events };
}

/** The event a ground-truth quote comes from. */
export function eventFor<E extends { file: string; text: string }>(events: readonly E[], q: Quote): E | undefined {
  const want = normaliseForQuote(q.text);
  return events.find((e) => e.file === q.file && normaliseForQuote(e.text).includes(want));
}
