// npm run capture -- <remotion project> --composition <id> [--entry src/index.ts] [--out dir] [--scale 2] [--run] [--replace]
//   Captures any Remotion composition and writes an After Effects script + layer images
//   (default <project>/out/after-effects/<composition>.jsx and layers/).
//   --run       also build it now in the running After Effects
//   --replace   the script first deletes an earlier import of the same composition (handy with --run)
// npm run capture -- <remotion project> --list
//   Lists the project's compositions.
// --progress <file>: keep a status file up to date (JSON: state, stage, done, total, message, result/error);
//   the After Effects panel reads it.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runScript } from "./bridge.ts";
import { capture } from "./capture/capture.ts";
import { listCompositions } from "./capture/remotion-page.ts";
import { asciiLiteral, sceneScript } from "./jsx.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = args[0];
const composition = flag("--composition");
const listing = args.includes("--list");
const progressFile = flag("--progress");

/** Status for the After Effects panel; written whole and renamed, so it is never read half-written. */
function status(value: Record<string, unknown>) {
  if (!progressFile) return;
  writeFileSync(`${progressFile}.tmp`, asciiLiteral(value));
  renameSync(`${progressFile}.tmp`, progressFile);
}

if (!projectDir || projectDir.startsWith("--") || (!composition && !listing)) {
  console.error("usage: npm run capture -- <remotion project> --composition <id> [--entry src/index.ts] [--out dir] [--scale 2] [--run] [--replace]");
  console.error("       npm run capture -- <remotion project> --list");
  process.exit(2);
}

try {
  const dir = path.resolve(projectDir);
  if (listing) {
    status({ state: "running", stage: "opening", done: 0, total: 1, message: "Reading the project's compositions" });
    const compositions = await listCompositions(dir, flag("--entry"));
    for (const c of compositions) console.log(`${c.id}  ${c.width}x${c.height}  ${c.fps}fps  ${c.durationInFrames} frames`);
    status({ state: "done", compositions });
  } else {
    const outDir = path.resolve(flag("--out") ?? path.join(dir, "out", "after-effects"));
    mkdirSync(outDir, { recursive: true });
    const started = Date.now();
    const { scene, notes } = await capture({
      projectDir: dir,
      entry: flag("--entry"),
      composition: composition!,
      outDir,
      scale: Number(flag("--scale") ?? 2),
      onProgress: (p) => status({ state: "running", ...p }),
    });
    const jsx = path.join(outDir, `${composition}.jsx`);
    writeFileSync(jsx, sceneScript(scene, { replace: args.includes("--replace") }));
    const layers = scene.comps.reduce((n, c) => n + c.layers.length, 0);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`${scene.name}: ${scene.comps.length} comps, ${layers} layers, ${scene.footage.length} images (${seconds}s)`);
    for (const n of notes) console.log(`note: ${n}`);
    console.log(`script: ${jsx}`);
    status({ state: "done", result: { jsx, comps: scene.comps.length, layers, seconds, notes } });
    if (args.includes("--run")) console.log(await runScript(jsx, { timeoutSec: 600 }));
  }
} catch (e) {
  const message = (e as Error).message ?? String(e);
  status({ state: "error", error: message });
  console.error(`error: ${(e as Error).stack ?? e}`);
  process.exit(1);
}
