// npm run export -- <remo project> [--lang bn] [--out file.jsx] [--run] [--replace]
//   Writes an After Effects script that builds the project (default <project>/renders/after-effects[.lang].jsx).
//   --run      also build it now in the running After Effects
//   --replace  with --run: delete an earlier import of the same project first
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runScript } from "./bridge.ts";
import { sceneScript } from "./jsx.ts";
import { remoProject, remoScene } from "./remo/adapter.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args[0];
if (!dir || dir.startsWith("--")) {
  console.error("usage: npm run export -- <remo project> [--lang bn] [--out file.jsx] [--run] [--replace]");
  process.exit(2);
}

try {
  const project = remoProject(dir, flag("--lang"));
  const out = path.resolve(flag("--out") ?? path.join(project.renders, `after-effects${project.suffix}.jsx`));
  const { scene, notes } = remoScene(project, path.dirname(out));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, sceneScript(scene, { replace: args.includes("--replace") }));
  const layers = scene.comps.reduce((n, c) => n + c.layers.length, 0);
  console.log(`${scene.name}: ${scene.comps.length} comps, ${layers} layers, ${scene.footage.length} files`);
  for (const n of notes) console.log(`note: ${n}`);
  console.log(`script: ${out}`);
  if (args.includes("--run")) console.log(await runScript(out, { timeoutSec: 300 }));
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
