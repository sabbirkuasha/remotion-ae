// npm run install-panel: put the Remotion Importer panel into every installed After Effects
// (<After Effects>/Support Files/Scripts/ScriptUI Panels/Remotion Importer.jsx), pointing at this remotion-ae folder.
// Restart After Effects afterwards; the panel is under Window > Remotion Importer.jsx.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEffectsInstalls } from "./bridge.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const panel = readFileSync(path.join(ROOT, "ae", "RemotionImporter.jsx"), "utf8").replace(
  "@@REMOTION_AE_DIR@@",
  ROOT.replace(/\\/g, "/"),
);

const installs = afterEffectsInstalls();
if (!installs.length) {
  console.error("No After Effects installation found. Copy ae/RemotionImporter.jsx into After Effects' Scripts/ScriptUI Panels folder by hand.");
  process.exit(1);
}
let ok = 0;
for (const ae of installs) {
  const dir = path.join(ae.supportDir, "Scripts", "ScriptUI Panels");
  const target = path.join(dir, "Remotion Importer.jsx");
  try {
    if (!existsSync(dir)) throw new Error(`no folder ${dir}`);
    writeFileSync(target, panel);
    console.log(`installed: ${target}`);
    ok++;
  } catch (e) {
    console.error(`could not write ${target}: ${(e as Error).message}`);
    console.error("  run this command in a terminal opened with 'Run as administrator', or copy the file by hand.");
  }
}
if (ok) console.log("\nRestart After Effects, then open Window > Remotion Importer.jsx.");
process.exit(ok ? 0 : 1);
