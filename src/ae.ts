// npm run ae -- <script.jsx> [--timeout 120]: run a script in the running After Effects, print its result.
import { runScript } from "./bridge.ts";

const [script, ...rest] = process.argv.slice(2);
const t = rest.indexOf("--timeout");
if (!script) {
  console.error("usage: npm run ae -- <script.jsx> [--timeout 120]");
  process.exit(2);
}
try {
  console.log(await runScript(script, { timeoutSec: t >= 0 ? Number(rest[t + 1]) : 120 }));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
