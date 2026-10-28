// Image comparison with ffmpeg: SSIM scores and side-by-side images (Remotion | After Effects | difference x4).
import { spawnSync } from "node:child_process";

// Frames are scored at quarter size ("view"): Chrome and AE decode and resample images slightly differently,
// which full-size SSIM ("pixel") punishes although nobody can see it.
export const VIEW_WIDTH = 480;
export const GOOD = 0.98; // view SSIM below this gets flagged

function ffmpeg(args: string[]): string {
  const r = spawnSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-500)}`);
  return r.stderr;
}

/** SSIM, optionally after shrinking both images to `width` (hides resampling sharpness, keeps layout/colour/timing). */
export function ssim(a: string, b: string, width?: number): number {
  const prep = width ? `format=rgb24,scale=${width}:-2:flags=area` : "format=rgb24";
  const log = ffmpeg(["-i", a, "-i", b, "-lavfi", `[0:v]${prep}[x];[1:v]${prep}[y];[x][y]ssim`, "-f", "null", "-"]);
  return Number(/All:([\d.]+)/.exec(log)?.[1] ?? NaN);
}

export function sideBySide(a: string, b: string, out: string) {
  const boost = "min(val*4\\,255)";
  ffmpeg([
    "-y", "-i", a, "-i", b, "-filter_complex",
    "[0:v]format=rgb24,split[a1][a2];[1:v]format=rgb24,split[b1][b2];" +
      `[a2][b2]blend=all_mode=difference,lutrgb=r='${boost}':g='${boost}':b='${boost}'[d];` +
      "[a1][b1][d]hstack=inputs=3,scale=2400:-2",
    "-frames:v", "1", out,
  ]);
}
