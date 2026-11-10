// Writes each generated scenario's export files from data/scenarios/<name>/world.yaml (SYNTHETIC).
// Offline and free: no model is called. `--check` fails if the committed files are out of date.
//   pnpm gen:scenario                 every scenario with a world.yaml
//   pnpm gen:scenario -- year         one scenario
//   pnpm gen:scenario -- --check      compare only

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileBytes, generateScenario } from "../src/lib/synth/generate.ts";
import { loadWorld } from "../src/lib/synth/world.ts";

const ROOT = "data/scenarios/";
const check = process.argv.includes("--check");
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const names = named.length ? named : readdirSync(ROOT).filter((d) => existsSync(`${ROOT}${d}/world.yaml`)).sort();

let stale = 0;
for (const scenario of names) {
  const dir = `${ROOT}${scenario}/`;
  const files = generateScenario(loadWorld(readFileSync(dir + "world.yaml", "utf8")));
  for (const [name, content] of Object.entries(files)) {
    const bytes = fileBytes(content);
    const same = existsSync(dir + name) && Buffer.from(readFileSync(dir + name)).equals(Buffer.from(bytes));
    if (check) {
      if (!same) stale++;
      console.log(`${same ? "ok   " : "STALE"} ${scenario}/${name}`);
    } else {
      writeFileSync(dir + name, bytes);
      console.log(`wrote ${scenario}/${name} (${bytes.length} bytes)`);
    }
  }
}
if (stale) {
  console.error("Run `pnpm gen:scenario` and commit the result.");
  process.exit(1);
}
