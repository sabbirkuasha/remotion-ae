// node tools/test-panel.ts <remotion project> [composition]
// Opens the Remotion Importer panel (as a floating window) in the running After Effects, lists the project's
// compositions, imports one, and follows the panel's status text until it finishes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSource } from "../src/bridge.ts";
import { asciiLiteral } from "../src/jsx.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [project, composition] = process.argv.slice(2);
if (!project) {
  console.error("usage: node tools/test-panel.ts <remotion project> [composition]");
  process.exit(2);
}
const panel = `$.global.remotionAEPanel`;
const statusOf = () =>
  runSource(`${panel}.ui.statusText.text + " ||| " + ${panel}.ui.compList.items.length + " ||| " + ${panel}.ui.bar.value`);

async function waitFor(what: string, done: (status: string) => boolean, timeoutSec: number) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = "";
  for (;;) {
    const s = await statusOf();
    if (s !== last) console.log(`  ${s.replace(/\n/g, " / ")}`);
    last = s;
    if (done(s)) return s;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

console.log("opening the panel");
console.log(await runSource(`$.evalFile(new File(${asciiLiteral(path.join(ROOT, "ae", "RemotionImporter.jsx").replace(/\\/g, "/"))})); "panel open"`));
console.log("listing compositions");
await runSource(`${panel}.ui.projectText.text = ${asciiLiteral(project)}; ${panel}.list(); "ok"`);
const listed = await waitFor("the composition list", (s) => !/^(Starting|Reading)/.test(s), 180);
if (!/found/.test(listed)) process.exit(1);
if (composition) {
  await runSource(`var l = ${panel}.ui.compList; for (var i = 0; i < l.items.length; i++) if (l.items[i].text === ${asciiLiteral(composition)}) l.selection = i; "ok"`);
}
console.log("importing");
await runSource(`${panel}.importNow(); "ok"`);
const final = await waitFor("the import", (s) => /^Built|failed|Could not/m.test(s.split(" ||| ")[0]), 900);
process.exit(/^Built/.test(final) ? 0 : 1);
