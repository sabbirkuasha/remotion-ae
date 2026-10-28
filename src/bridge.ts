// Run ExtendScript inside the running After Effects and get its result back.
// The script's last expression is its result; a thrown error is re-thrown here with file and line.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asciiLiteral } from "./jsx.ts";

export const AFTERFX =
  process.env.AFTERFX ?? "D:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe";

const RUNS = fileURLToPath(new URL("../.runs/", import.meta.url));

const jsxPath = (p: string) => p.replace(/\\/g, "/");

export async function runScript(script: string, { timeoutSec = 120 } = {}): Promise<string> {
  const file = resolve(script);
  if (!existsSync(file)) throw new Error(`no such script: ${file}`);
  mkdirSync(RUNS, { recursive: true });
  const id = `${Date.now()}_${process.pid}`;
  const resultPath = join(RUNS, `${id}.json`);
  const wrapperPath = join(RUNS, `${id}.jsx`);
  writeFileSync(
    wrapperPath,
    `(function () {
  function q(s) {
    return '"' + String(s).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"')
      .replace(/\\r/g, "\\\\r").replace(/\\n/g, "\\\\n").replace(/\\t/g, "\\\\t") + '"';
  }
  var body;
  app.beginSuppressDialogs();
  try {
    var value = $.evalFile(new File(${asciiLiteral(jsxPath(file))}));
    body = '{"ok":true,"value":' + q(value) + '}';
  } catch (e) {
    body = '{"ok":false,"error":' + q(e.toString()) + ',"line":' + q(e.line) + ',"file":' + q(e.fileName) + '}';
  }
  app.endSuppressDialogs(false);
  var tmp = new File(${asciiLiteral(jsxPath(resultPath + ".tmp"))});
  tmp.encoding = "UTF-8";
  tmp.open("w");
  tmp.write(body);
  tmp.close();
  tmp.rename(${asciiLiteral(basename(resultPath))});
})();
`,
  );

  spawn(AFTERFX, ["-r", wrapperPath], { detached: true, stdio: "ignore" }).unref();

  const deadline = Date.now() + timeoutSec * 1000;
  try {
    while (!existsSync(resultPath)) {
      if (Date.now() > deadline) {
        throw new Error(
          `no result from After Effects after ${timeoutSec}s: check AE for an open dialog, and that ` +
            `"Allow Scripts to Write Files and Access Network" is on`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!result.ok) throw new Error(`After Effects: ${result.error}\n  at ${result.file}:${result.line}`);
    return result.value as string;
  } finally {
    rmSync(resultPath, { force: true });
    rmSync(wrapperPath, { force: true });
  }
}

/** Write ExtendScript source to a temp file and run it. */
export async function runSource(source: string, options?: { timeoutSec?: number }): Promise<string> {
  mkdirSync(RUNS, { recursive: true });
  const file = join(RUNS, `src_${Date.now()}_${process.pid}.jsx`);
  writeFileSync(file, source);
  try {
    return await runScript(file, options);
  } finally {
    rmSync(file, { force: true });
  }
}
