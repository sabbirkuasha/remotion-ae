// node tools/calibrate-blur.ts: find AE Gaussian Blur "Blurriness" per CSS blur() px (AE_BLUR_PER_CSS_BLUR in
// src/remo/adapter.ts). Renders fixtures/vertical's backdrop at several strengths (tools/calibrate-blur.jsx) and
// scores the top 600 rows, where only the backdrop shows, against remo's frame 45. Run `npm run compare --
// fixtures/vertical` first for the reference frame.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScript, runSource } from "../src/bridge.ts";
import { asciiLiteral } from "../src/jsx.ts";
import { waitForPngs } from "./png.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(ROOT, "test-output", "calibrate");
const ref = path.join(ROOT, "test-output", "vertical", "remotion", "remotion_00045.png");
const image = path.join(ROOT, "fixtures", "vertical", "assets", "images", "01_street.jpg");
const slashes = (p: string) => p.replace(/\\/g, "/");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const body = readFileSync(path.join(ROOT, "tools", "calibrate-blur.jsx"), "utf8");
const script = `var FIXTURE_IMAGE = ${asciiLiteral(slashes(image))};\nvar OUT_DIR = ${asciiLiteral(slashes(out))};\n${body}`;
const factors = (await runSource(script)).trim().split(",");
const missing = await waitForPngs(factors.map((f) => path.join(out, `blur_${f}.png`)));
if (missing.length) throw new Error(`AE did not write ${missing.join(", ")}`);
await runScript(path.join(ROOT, "tools", "purge.jsx"));

const crop = "format=rgb24,crop=1080:600:0:0";
for (const f of factors) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", ref, "-i", path.join(out, `blur_${f}.png`), "-lavfi", `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]ssim`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  console.log(`factor ${f}: SSIM ${/All:([\d.]+)/.exec(r.stderr ?? "")?.[1] ?? "failed"}`);
}
