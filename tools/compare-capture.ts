// npm run compare-capture -- <remotion project> --composition <id> [--entry src/index.ts] [--every 15] [--scale 2]
// Captures the composition, builds it in After Effects, renders the same frames there, and scores them against
// Remotion's own frames (taken during the capture). Output in test-output/<composition>/.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScript } from "../src/bridge.ts";
import { capture } from "../src/capture/capture.ts";
import { asciiLiteral, sceneScript } from "../src/jsx.ts";
import { GOOD, sideBySide, ssim, VIEW_WIDTH } from "./image-compare.ts";
import { pngComplete, waitForPngs } from "./png.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = path.resolve(args[0] ?? "");
const composition = flag("--composition");
if (!args[0] || !composition) {
  console.error("usage: npm run compare-capture -- <remotion project> --composition <id> [--entry src/index.ts] [--every 15]");
  process.exit(2);
}
const every = Number(flag("--every") ?? 15);
const out = path.join(ROOT, "test-output", composition);
const dirs = { export: path.join(out, "export"), remotion: path.join(out, "remotion"), ae: path.join(out, "ae"), compare: path.join(out, "compare") };
for (const d of Object.values(dirs)) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

// frames to check: every `every` frames, plus the last one (the duration is only known after opening, so ask for many)
const wanted = Array.from({ length: 2000 }, (_, i) => i * every);
const started = Date.now();
const { scene, notes } = await capture({
  projectDir,
  entry: flag("--entry") ?? "src/index.ts",
  composition,
  outDir: dirs.export,
  scale: Number(flag("--scale") ?? 2),
  referenceFrames: wanted,
  referenceDir: dirs.remotion,
});
const total = scene.comps.find((c) => c.id === scene.main)!.frames;
const frames = [...wanted.filter((f) => f < total)];
console.log(`captured in ${((Date.now() - started) / 1000).toFixed(0)}s; ${notes.length} note(s)`);
for (const n of notes) console.log(`note: ${n}`);

const script = path.join(dirs.export, `${composition}.jsx`);
writeFileSync(script, sceneScript(scene, { replace: true }));
writeFileSync(
  path.join(out, "build.jsx"),
  sceneScript(scene, { replace: true }, `remotionAE.saveFrames(remotionAE.main, ${asciiLiteral(frames)}, ${asciiLiteral(dirs.ae.replace(/\\/g, "/"))})`),
);
console.log(await runScript(path.join(out, "build.jsx"), { timeoutSec: 900 }));
const aeFrame = (f: number) => path.join(dirs.ae, `ae_${String(f).padStart(5, "0")}.png`);
await waitForPngs(frames.map(aeFrame), 300_000);
await runScript(path.join(ROOT, "tools", "purge.jsx"));

const rows: string[] = [];
let flagged = 0;
for (const f of frames) {
  const a = path.join(dirs.remotion, `remotion_${String(f).padStart(5, "0")}.png`);
  const b = aeFrame(f);
  if (!pngComplete(b)) {
    rows.push(`| ${f} | missing AE frame | | |`);
    flagged++;
    continue;
  }
  const view = ssim(a, b, VIEW_WIDTH);
  const pixel = ssim(a, b);
  sideBySide(a, b, path.join(dirs.compare, `f${String(f).padStart(5, "0")}.png`));
  const bad = !(view >= GOOD);
  if (bad) flagged++;
  rows.push(`| ${f} | ${view.toFixed(4)} | ${pixel.toFixed(4)} | ${bad ? "**check**" : ""} |`);
}
const report = [
  `# ${composition}: Remotion vs After Effects (captured)`,
  "",
  `SSIM per frame, 1 = identical. "view" is scored at ${VIEW_WIDTH}px wide and flagged below ${GOOD}; "pixel" is full size.`,
  "Images: compare/fNNNNN.png = Remotion | AE | difference x4.",
  "",
  "| frame | view | pixel | |",
  "|---|---|---|---|",
  ...rows,
  "",
].join("\n");
writeFileSync(path.join(out, "report.md"), report);
console.log(report);
console.log(`${flagged ? `${flagged} frame(s) flagged` : "all frames match"}; images in ${dirs.compare}`);
