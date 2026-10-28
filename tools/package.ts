// npm run package: the download for GitHub Releases, dist/remotion-ae-<version>-windows.zip.
// It holds what the After Effects panel needs (ae/, src/, no dependencies; Node runs the sources directly) and
// Install.cmd / Uninstall.cmd from packaging/ at the top. The release workflow (.github/workflows/release.yml)
// runs this and attaches the zip to the release.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const name = `remotion-ae-${version}`;
const dist = path.join(ROOT, "dist");
const stage = path.join(dist, name);
const zip = path.join(dist, `${name}-windows.zip`);

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });
for (const f of ["ae", "src", "package.json", "LICENSE", "README.md"]) cpSync(path.join(ROOT, f), path.join(stage, f), { recursive: true });
// batch files need Windows line endings, whatever the checkout did
for (const f of ["Install.cmd", "Uninstall.cmd"]) {
  const text = readFileSync(path.join(ROOT, "packaging", f), "utf8").replace(/\r?\n/g, "\r\n");
  writeFileSync(path.join(stage, f), text);
}

// Windows' own tar writes zip files (-a picks the format from the extension); elsewhere, zip
const r =
  process.platform === "win32"
    ? spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", dist, name], { stdio: "inherit" })
    : spawnSync("zip", ["-r", "-q", zip, name], { cwd: dist, stdio: "inherit" });
if (r.status !== 0) {
  console.error("could not create the zip file");
  process.exit(1);
}
rmSync(stage, { recursive: true, force: true });
console.log(`release download: ${zip}`);
