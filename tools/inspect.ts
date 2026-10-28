// node tools/inspect.ts "<folder name>": print the structure of a project built in the open After Effects.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSource } from "../src/bridge.ts";
import { asciiLiteral } from "../src/jsx.ts";

const folder = process.argv[2];
if (!folder) {
  console.error('usage: node tools/inspect.ts "<project folder name in AE>"');
  process.exit(2);
}
const body = readFileSync(fileURLToPath(new URL("./inspect.jsx", import.meta.url)), "utf8");
console.log(await runSource(`var INSPECT_FOLDER = ${asciiLiteral(folder)};\n${body}`));
