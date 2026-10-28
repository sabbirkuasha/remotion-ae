// Render reference frames with the remo player itself (its own Remotion install), one bundle for all frames.
// Frames are cached per timeline: unchanged timeline + existing PNG = no re-render.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { RemoProject } from "../src/remo/adapter.ts";

export const remotionFrame = (dir: string, f: number) => path.join(dir, `remotion_${String(f).padStart(5, "0")}.png`);

export async function renderRemotionFrames(remoRoot: string, project: RemoProject, frames: number[], dir: string) {
  const timeline = JSON.parse(readFileSync(project.timeline, "utf8"));
  const hash = createHash("sha1").update(JSON.stringify(timeline)).digest("hex");
  const hashFile = path.join(dir, "timeline.sha1");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(hashFile) || readFileSync(hashFile, "utf8") !== hash) {
    for (const f of readdirSync(dir)) rmSync(path.join(dir, f));
    writeFileSync(hashFile, hash);
  }
  const missing = frames.filter((f) => !existsSync(remotionFrame(dir, f)));
  if (!missing.length) return;

  const req = createRequire(path.join(remoRoot, "package.json"));
  const { bundle } = req("@remotion/bundler");
  const { openBrowser, selectComposition, renderStill } = req("@remotion/renderer");
  const serveUrl = await bundle({ entryPoint: path.join(remoRoot, "src", "index.ts"), publicDir: project.assets });
  const browser = await openBrowser("chrome");
  try {
    const composition = await selectComposition({ serveUrl, id: "Episode", inputProps: timeline, puppeteerInstance: browser });
    for (const frame of missing) {
      await renderStill({
        composition,
        serveUrl,
        frame,
        output: remotionFrame(dir, frame),
        inputProps: timeline,
        imageFormat: "png",
        overwrite: true,
        puppeteerInstance: browser,
      });
    }
  } finally {
    await browser.close({ silent: true });
  }
}
