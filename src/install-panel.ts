// npm run install-panel: put the Remotion Importer panel into every installed After Effects
// (<After Effects>/Support Files/Scripts/ScriptUI Panels/Remotion Importer.jsx), pointing at this remotion-ae folder.
// Restart After Effects afterwards; the panel is under Window > Remotion Importer.jsx.
//   --app-dir <dir>   first copy remotion-ae into <dir> and point the panel there (Install.cmd in the download uses
//                     %LOCALAPPDATA%\remotion-ae, so the downloaded folder can be deleted afterwards)
//   --uninstall       remove the panel from every After Effects, and <dir> if --app-dir is given
// Panel folders that need administrator rights are written through one Windows administrator prompt (UAC).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEffectsInstalls } from "./bridge.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PANEL = "Remotion Importer.jsx";
// what the panel needs at run time: the capture engine and the After Effects builder (no dependencies)
const APP_FILES = ["ae", "src", "package.json", "LICENSE", "README.md"];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const appDir = flag("--app-dir") ? path.resolve(flag("--app-dir")!) : undefined;
const uninstall = args.includes("--uninstall");

/** Run PowerShell commands as administrator, behind one UAC prompt, and wait for them. */
function asAdministrator(commands: string[]) {
  const encode = (s: string) => Buffer.from(s, "utf16le").toString("base64");
  const inner = encode(`$ErrorActionPreference = 'Stop'\n${commands.join("\n")}`);
  const outer =
    `$ProgressPreference = 'SilentlyContinue'\n` +
    `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${inner}'`;
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encode(outer)], { stdio: "inherit" });
}
const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A folder that is safe to replace: missing, empty, or an earlier copy of remotion-ae. */
function isAppFolder(dir: string) {
  if (!existsSync(dir) || !readdirSync(dir).length) return true;
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name === "remotion-ae";
  } catch {
    return false;
  }
}

if (appDir && appDir !== ROOT && !isAppFolder(appDir)) {
  console.error(`${appDir} exists and is not a remotion-ae folder; leaving it alone. Choose another --app-dir.`);
  process.exit(1);
}

const installs = afterEffectsInstalls();
const targets = installs.map((ae) => path.join(ae.supportDir, "Scripts", "ScriptUI Panels", PANEL));

if (uninstall) {
  const left = targets.filter((t) => existsSync(t));
  const denied: string[] = [];
  for (const t of left) {
    try {
      rmSync(t);
    } catch {
      denied.push(t);
    }
  }
  if (denied.length) {
    console.log("Removing the panel needs administrator rights; Windows will ask for permission.");
    asAdministrator(denied.map((t) => `Remove-Item -LiteralPath ${psString(t)} -Force`));
  }
  for (const t of left) console.log(existsSync(t) ? `could not remove ${t}` : `removed: ${t}`);
  if (appDir && appDir !== ROOT && existsSync(appDir)) {
    rmSync(appDir, { recursive: true, force: true });
    console.log(`removed: ${appDir}`);
  }
  process.exit(left.some((t) => existsSync(t)) ? 1 : 0);
}

if (!installs.length) {
  console.error("No After Effects installation found. Copy ae/RemotionImporter.jsx into After Effects' Scripts/ScriptUI Panels folder by hand.");
  process.exit(1);
}

let home = ROOT;
if (appDir && appDir !== ROOT) {
  rmSync(appDir, { recursive: true, force: true });
  for (const f of APP_FILES) if (existsSync(path.join(ROOT, f))) cpSync(path.join(ROOT, f), path.join(appDir, f), { recursive: true });
  console.log(`copied remotion-ae to ${appDir}`);
  home = appDir;
}

const panel = readFileSync(path.join(home, "ae", "RemotionImporter.jsx"), "utf8").replace(
  "@@REMOTION_AE_DIR@@",
  home.replace(/\\/g, "/"),
);
const installed = (t: string) => existsSync(t) && readFileSync(t, "utf8") === panel;

const denied: string[] = [];
for (const t of targets) {
  if (!existsSync(path.dirname(t))) {
    console.error(`no folder ${path.dirname(t)}`);
    continue;
  }
  try {
    writeFileSync(t, panel);
  } catch {
    denied.push(t);
  }
}
if (denied.length) {
  // After Effects is usually under Program Files, which only administrators may change
  console.log("After Effects' panel folder needs administrator rights; Windows will ask for permission.");
  const tmp = mkdtempSync(path.join(tmpdir(), "remotion-ae-"));
  const source = path.join(tmp, PANEL);
  writeFileSync(source, panel);
  asAdministrator(denied.map((t) => `Copy-Item -LiteralPath ${psString(source)} -Destination ${psString(t)} -Force`));
  rmSync(tmp, { recursive: true, force: true });
}

let ok = 0;
for (const t of targets) {
  if (installed(t)) {
    console.log(`installed: ${t}`);
    ok++;
  } else if (existsSync(path.dirname(t))) {
    console.error(`could not write ${t}`);
    console.error("  allow the administrator prompt, or copy the file there by hand.");
  }
}
if (ok) console.log("\nRestart After Effects, then open Window > Remotion Importer.jsx.");
process.exit(ok ? 0 : 1);
