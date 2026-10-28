// npm run capture -- <remotion project> --composition <id> [--entry src/index.ts] [--out dir] [--scale 2] [--run] [--replace]
//   Captures any Remotion composition and writes an After Effects script + layer images
//   (default <project>/out/after-effects/<composition>.jsx and layers/).
//   --run      also build it now in the running After Effects
//   --replace  the script first deletes an earlier import of the same composition (handy with --run)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runScript } from "./bridge.ts";
import { capture } from "./capture/capture.ts";
import { sceneScript } from "./jsx.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = args[0];
const composition = flag("--composition");
if (!projectDir || projectDir.startsWith("--") || !composition) {
  console.error("usage: npm run capture -- <remotion project> --composition <id> [--entry src/index.ts] [--out dir] [--scale 2] [--run] [--replace]");
  process.exit(2);
}

try {
  const dir = path.resolve(projectDir);
  const outDir = path.resolve(flag("--out") ?? path.join(dir, "out", "after-effects"));
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const { scene, notes } = await capture({
    projectDir: dir,
    entry: flag("--entry") ?? "src/index.ts",
    composition,
    outDir,
    scale: Number(flag("--scale") ?? 2),
  });
  const jsx = path.join(outDir, `${composition}.jsx`);
  writeFileSync(jsx, sceneScript(scene, { replace: args.includes("--replace") }));
  const layers = scene.comps.reduce((n, c) => n + c.layers.length, 0);
  console.log(`${scene.name}: ${scene.comps.length} comps, ${layers} layers, ${scene.footage.length} images (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  for (const n of notes) console.log(`note: ${n}`);
  console.log(`script: ${jsx}`);
  if (args.includes("--run")) console.log(await runScript(jsx, { timeoutSec: 600 }));
} catch (e) {
  console.error(`error: ${(e as Error).stack ?? e}`);
  process.exit(1);
}
