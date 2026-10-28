// Print where brightness jumps along one row or column of a PNG: node tools/probe-pixels.mjs <png> <row|col> <index> [from] [to]
// Used to measure box edges and text positions when calibrating against Remotion.
import { spawnSync } from "node:child_process";

const [file, axis, indexArg, fromArg, toArg] = process.argv.slice(2);
const index = Number(indexArg);
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
const [w, h] = probe.stdout.trim().split(",").map(Number);
const crop = axis === "row" ? `crop=${w}:1:0:${index}` : `crop=1:${h}:${index}:0`;
const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `${crop},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
const px = [...r.stdout];
const from = Number(fromArg ?? 0);
const to = Number(toArg ?? px.length - 1);
const out = [];
for (let i = Math.max(1, from); i <= Math.min(to, px.length - 1); i++) {
  if (Math.abs(px[i] - px[i - 1]) >= 12) out.push(`${i}:${px[i - 1]}->${px[i]}`);
}
console.log(out.join("  "));
