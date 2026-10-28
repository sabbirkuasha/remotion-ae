// npm run compare -- <remo project> [--lang bn] [--frames 0,45,90] [--remo ../remo] [--out dir]
// Builds the project in After Effects, renders the same frames there and with the remo player, and scores
// each pair (SSIM, 1 = identical). Writes side-by-side images (Remotion | After Effects | difference x4)
// and report.md to test-output/<project>/.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScript } from "../src/bridge.ts";
import { asciiLiteral, sceneScript } from "../src/jsx.ts";
import { loadTimeline, remoProject, remoScene } from "../src/remo/adapter.ts";
import type { Timeline } from "../src/remo/schema.ts";
import { computeTimings } from "../src/remo/timing.ts";
import { pngComplete, waitForPngs } from "./png.ts";
import { remotionFrame, renderRemotionFrames } from "./remotion-frames.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Frames are scored at quarter size ("view"): Chrome and AE decode and resample images slightly differently,
// which full-size SSIM ("pixel") punishes although nobody can see it.
const VIEW_WIDTH = 480;
const GOOD = 0.98; // view SSIM below this gets flagged

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

type Pick = { frame: number; what: string };

/** Frames worth checking: start/end, every shot's middle, every transition's middle, each closing line arriving. */
function pickFrames(t: Timeline): Pick[] {
  const { shots, totalFrames } = computeTimings(t);
  const picks: Pick[] = [{ frame: 0, what: "start" }];
  shots.forEach((s, i) => {
    picks.push({ frame: s.from + Math.floor(s.durationInFrames / 2), what: `${s.shot.id} middle` });
    if (s.transitionFrames) {
      picks.push({
        frame: shots[i + 1].from + Math.floor(s.transitionFrames / 2),
        what: `${s.shot.id} -> ${shots[i + 1].shot.id} ${s.shot.transition}`,
      });
    }
    s.shot.lines?.forEach((_, k, all) => {
      const start = Math.round(0.4 * t.fps + (k * s.durationInFrames * 0.6) / all.length);
      picks.push({ frame: s.from + start + Math.round(t.fps / 2), what: `${s.shot.id} line ${k + 1} arriving` });
    });
  });
  picks.push({ frame: totalFrames - 1, what: "end" });
  const seen = new Set<number>();
  return picks.filter((p) => !seen.has(p.frame) && seen.add(p.frame)).sort((a, b) => a.frame - b.frame);
}

function ffmpeg(args: string[]): string {
  const r = spawnSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-500)}`);
  return r.stderr;
}

/** SSIM, optionally after shrinking both images to `width` (hides resampling sharpness, keeps layout/colour/timing). */
function ssim(a: string, b: string, width?: number): number {
  const prep = width ? `format=rgb24,scale=${width}:-2:flags=area` : "format=rgb24";
  const log = ffmpeg(["-i", a, "-i", b, "-lavfi", `[0:v]${prep}[x];[1:v]${prep}[y];[x][y]ssim`, "-f", "null", "-"]);
  return Number(/All:([\d.]+)/.exec(log)?.[1] ?? NaN);
}

function sideBySide(a: string, b: string, out: string) {
  const boost = "min(val*4\\,255)";
  ffmpeg([
    "-y", "-i", a, "-i", b, "-filter_complex",
    "[0:v]format=rgb24,split[a1][a2];[1:v]format=rgb24,split[b1][b2];" +
      `[a2][b2]blend=all_mode=difference,lutrgb=r='${boost}':g='${boost}':b='${boost}'[d];` +
      "[a1][b1][d]hstack=inputs=3,scale=2400:-2",
    "-frames:v", "1", out,
  ]);
}

const dir = args[0];
if (!dir || dir.startsWith("--")) {
  console.error("usage: npm run compare -- <remo project> [--lang bn] [--frames 0,45] [--remo ../remo] [--out dir]");
  process.exit(2);
}
const project = remoProject(dir, flag("--lang"));
const t = loadTimeline(project).timeline;
const out = path.resolve(flag("--out") ?? path.join(ROOT, "test-output", path.basename(project.dir) + project.suffix));
const remoRoot = path.resolve(flag("--remo") ?? path.join(ROOT, "..", "remo"));
const picks: Pick[] = flag("--frames")
  ? flag("--frames")!.split(",").map((f) => ({ frame: Number(f), what: "" }))
  : pickFrames(t);
const frames = picks.map((p) => p.frame);
const aeDir = path.join(out, "ae");
const remotionDir = path.join(out, "remotion");
const cmpDir = path.join(out, "compare");
for (const d of [aeDir, cmpDir]) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

console.log(`${frames.length} frames: ${frames.join(", ")}`);
const { scene, notes } = remoScene(project, out);
for (const n of notes) console.log(`note: ${n}`);
const script = path.join(out, "build.jsx");
writeFileSync(
  script,
  sceneScript(scene, { replace: true }, `remotionAE.saveFrames(remotionAE.main, ${asciiLiteral(frames)}, ${asciiLiteral(aeDir.replace(/\\/g, "/"))})`),
);
console.log(await runScript(script, { timeoutSec: 900 }));

console.log("rendering reference frames with remo...");
await renderRemotionFrames(remoRoot, project, frames, remotionDir);

const aeFrame = (f: number) => path.join(aeDir, `ae_${String(f).padStart(5, "0")}.png`);
await waitForPngs(frames.map(aeFrame));
await runScript(path.join(ROOT, "tools", "purge.jsx")); // test renders otherwise pile up in AE's RAM cache

const rows: string[] = [];
let flagged = 0;
for (const p of picks) {
  const a = remotionFrame(remotionDir, p.frame);
  const b = aeFrame(p.frame);
  if (!pngComplete(b)) {
    rows.push(`| ${p.frame} | ${(p.frame / t.fps).toFixed(2)}s | ${p.what} | missing AE frame | | |`);
    flagged++;
    continue;
  }
  const view = ssim(a, b, VIEW_WIDTH);
  const pixel = ssim(a, b);
  sideBySide(a, b, path.join(cmpDir, `f${String(p.frame).padStart(5, "0")}.png`));
  const bad = !(view >= GOOD);
  if (bad) flagged++;
  rows.push(
    `| ${p.frame} | ${(p.frame / t.fps).toFixed(2)}s | ${p.what} | ${view.toFixed(4)} | ${pixel.toFixed(4)} | ${bad ? "**check**" : ""} |`,
  );
}
const report = [
  `# ${scene.name}: Remotion vs After Effects`,
  "",
  `SSIM per frame, 1 = identical. "view" is scored at ${VIEW_WIDTH}px wide and flagged below ${GOOD}; ` +
    `"pixel" is full size. Images: compare/fNNNNN.png = Remotion | AE | difference x4.`,
  "",
  "| frame | time | what | view | pixel | |",
  "|---|---|---|---|---|---|",
  ...rows,
  "",
].join("\n");
writeFileSync(path.join(out, "report.md"), report);
console.log(report);
console.log(`${flagged ? `${flagged} frame(s) flagged` : "all frames match"}; images in ${cmpDir}`);
