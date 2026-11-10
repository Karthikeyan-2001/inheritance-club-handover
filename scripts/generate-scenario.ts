// Writes the year scenario's export files from data/scenarios/year/world.yaml (SYNTHETIC).
// Offline and free: no model is called. `--check` fails if the committed files are out of date.
//   pnpm gen:scenario            write the files
//   pnpm gen:scenario -- --check compare only

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { generateScenario } from "../src/lib/synth/generate.ts";
import { loadWorld } from "../src/lib/synth/world.ts";

const DIR = "data/scenarios/year/";
const check = process.argv.includes("--check");
const files = generateScenario(loadWorld(readFileSync(DIR + "world.yaml", "utf8")));

mkdirSync(DIR, { recursive: true });
let stale = 0;
for (const [name, content] of Object.entries(files)) {
  const same = existsSync(DIR + name) && readFileSync(DIR + name, "utf8") === content;
  if (check) {
    if (!same) stale++;
    console.log(`${same ? "ok   " : "STALE"} ${name}`);
  } else {
    writeFileSync(DIR + name, content);
    console.log(`wrote ${name} (${content.length} bytes)`);
  }
}
if (stale) {
  console.error("Run `pnpm gen:scenario` and commit the result.");
  process.exit(1);
}
